// POST /api/autopost/asset?key=genre/meo.jpg
// DELETE /api/autopost/asset?key=genre/meo.jpg
// GET /api/autopost/asset?prefix=genre/
//
// R2 バケット `tusg-autopost-assets` のアップロード/削除/一覧管理エンドポイント。
// 認証: Authorization: Bearer <AUTOPOST_TRIGGER_TOKEN>
//
// 公開読み込みは /assets/<key> (functions/assets/[[path]].js) で無認証。
// R2 側にファイルを上げるとすぐに公開 URL でアクセス可能になる。
//
// アップロード方法 (curl):
//   curl -X POST \
//     -H "Authorization: Bearer $TOKEN" \
//     -H "Content-Type: image/jpeg" \
//     --data-binary "@/path/to/image.jpg" \
//     "https://tusg.site/api/autopost/asset?key=genre/meo.jpg"
//
// 命名規則の推奨:
//   genre/<key>.jpg          (曜日別テンプレ、7 種)
//   reel/<slug>.mp4          (リール動画)
//   story/<slug>.jpg         (ストーリーズ用)

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB
const KEY_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,199}$/i;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "video/mp4", "video/quicktime",
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function checkAuth(request, env) {
  const expected = env.AUTOPOST_TRIGGER_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("Authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  if (m[1].length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < m[1].length; i++) diff |= m[1].charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function siteUrl(request, env) {
  const configured = env.SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function publicUrl(request, env, key) {
  return `${siteUrl(request, env)}/assets/${key}`;
}

export async function onRequestPost({ request, env }) {
  if (!checkAuth(request, env)) return json({ ok: false, message: "Unauthorized" }, 401);
  if (!env.AUTOPOST_ASSETS) return json({ ok: false, message: "R2 binding not configured" }, 500);

  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!KEY_PATTERN.test(key)) {
    return json({ ok: false, message: "invalid key (a-z 0-9 . _ - / のみ, 200文字以内)" }, 400);
  }

  const contentType = (request.headers.get("Content-Type") || "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return json({
      ok: false,
      message: `Content-Type is required: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`,
    }, 400);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return json({ ok: false, message: `too large (>${MAX_UPLOAD_BYTES}B)` }, 413);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ ok: false, message: "empty body" }, 400);
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return json({ ok: false, message: `too large (>${MAX_UPLOAD_BYTES}B)` }, 413);
  }

  await env.AUTOPOST_ASSETS.put(key, body, {
    httpMetadata: { contentType },
  });

  return json({
    ok: true,
    key,
    size: body.byteLength,
    content_type: contentType,
    public_url: publicUrl(request, env, key),
  });
}

export async function onRequestDelete({ request, env }) {
  if (!checkAuth(request, env)) return json({ ok: false, message: "Unauthorized" }, 401);
  if (!env.AUTOPOST_ASSETS) return json({ ok: false, message: "R2 binding not configured" }, 500);

  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!KEY_PATTERN.test(key)) return json({ ok: false, message: "invalid key" }, 400);

  await env.AUTOPOST_ASSETS.delete(key);
  return json({ ok: true, key });
}

export async function onRequestGet({ request, env }) {
  if (!checkAuth(request, env)) return json({ ok: false, message: "Unauthorized" }, 401);
  if (!env.AUTOPOST_ASSETS) return json({ ok: false, message: "R2 binding not configured" }, 500);

  const url = new URL(request.url);
  const prefix = url.searchParams.get("prefix") || "";
  const listed = await env.AUTOPOST_ASSETS.list({ prefix, limit: 500 });
  return json({
    ok: true,
    prefix,
    count: listed.objects.length,
    truncated: listed.truncated,
    objects: listed.objects.map((o) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded,
      public_url: publicUrl(request, env, o.key),
    })),
  });
}
