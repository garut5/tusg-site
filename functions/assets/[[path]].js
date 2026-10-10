// GET /assets/<key>
//
// R2 バケット `tusg-autopost-assets` の公開読み込みルート。
// 認証なし (誰でもアクセス可) → Instagram Graph API が画像/動画 URL を fetch できる。
//
// 管理 (アップロード / 削除 / 一覧) は POST/DELETE/GET /api/autopost/asset で認証必須。

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

// アップロード時と同一ポリシー: ホワイトリスト以外はエラー扱い
// (想定外ファイルを画像/動画風に偽装してアップロードされた際の XSS/misinterpret 対策)
const ALLOWED_EXT_TO_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

function contentTypeFor(key) {
  const lower = key.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = lower.slice(dot + 1);
  return ALLOWED_EXT_TO_MIME[ext] || null;
}

// Content-Type ホワイトリスト (R2 側 httpMetadata を信用しすぎない)
const ALLOWED_MIME = new Set(Object.values(ALLOWED_EXT_TO_MIME));

export async function onRequestGet({ request, params, env }) {
  if (!env.AUTOPOST_ASSETS) {
    return new Response("R2 binding not configured", { status: 500 });
  }

  const path = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  // asset.js の KEY_PATTERN と同じ: lowercase/数字/. _ - / のみ、.. 禁止
  if (!path || !/^(?!.*\.\.)[a-z0-9][a-z0-9._/-]{0,199}$/.test(path)) {
    return new Response("Not found", { status: 404 });
  }
  const extCt = contentTypeFor(path);
  if (!extCt) return new Response("Not found", { status: 404 });

  const range = request.headers.get("Range") || undefined;
  const obj = range
    ? await env.AUTOPOST_ASSETS.get(path, { range: parseRange(range) })
    : await env.AUTOPOST_ASSETS.get(path);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  // R2 側の値も検証 (ホワイトリスト外は拡張子推定にフォールバック)
  const storedCt = (obj.httpMetadata?.contentType || "").toLowerCase().split(";")[0].trim();
  const ct = ALLOWED_MIME.has(storedCt) ? storedCt : extCt;
  headers.set("Content-Type", ct);
  headers.set("Cache-Control", IMMUTABLE_CACHE);
  headers.set("Accept-Ranges", "bytes");
  // sniffing / 実行防止 (万一 HTML が混入しても browser に解釈させない)
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", "inline");
  // Instagram/Threads が外部から fetch する必要があるので cross-origin 許可
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  // CSP: このレスポンス自体はスクリプト実行させない (nosniff と二重防御)
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  const size = obj.size;
  if (typeof size === "number") headers.set("Content-Length", String(size));

  return new Response(obj.body, {
    status: range ? 206 : 200,
    headers,
  });
}

function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m) return undefined;
  const [, s, e] = m;
  if (s === "" && e === "") return undefined;
  if (s === "") return { suffix: Number(e) };
  const offset = Number(s);
  if (e === "") return { offset };
  return { offset, length: Number(e) - offset + 1 };
}
