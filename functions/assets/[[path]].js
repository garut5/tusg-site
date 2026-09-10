// GET /assets/<key>
//
// R2 バケット `tusg-autopost-assets` の公開読み込みルート。
// 認証なし (誰でもアクセス可) → Instagram Graph API が画像/動画 URL を fetch できる。
//
// 管理 (アップロード / 削除 / 一覧) は POST/DELETE/GET /api/autopost/asset で認証必須。

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

function contentTypeFor(key) {
  const lower = key.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return "application/octet-stream";
}

export async function onRequestGet({ request, params, env }) {
  if (!env.AUTOPOST_ASSETS) {
    return new Response("R2 binding not configured", { status: 500 });
  }

  const path = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  if (!path || path.includes("..")) return new Response("Not found", { status: 404 });

  const range = request.headers.get("Range") || undefined;
  const obj = range
    ? await env.AUTOPOST_ASSETS.get(path, { range: parseRange(range) })
    : await env.AUTOPOST_ASSETS.get(path);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  const ct = obj.httpMetadata?.contentType || contentTypeFor(path);
  headers.set("Content-Type", ct);
  headers.set("Cache-Control", IMMUTABLE_CACHE);
  headers.set("Accept-Ranges", "bytes");
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
