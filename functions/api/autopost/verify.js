// GET /api/autopost/verify
//
// Instagram Graph API との疎通・トークン生存確認。投稿はしない。
// Authorization: Bearer <AUTOPOST_TRIGGER_TOKEN> 必須。
//
// 用途:
//   - Cloudflare secrets が正しく設定されているか確認
//   - 長期アクセストークンがまだ有効か確認 (60日ごとに要 refresh)
//   - Instagram Business Account ID が正しく紐付いているか確認
//
// 成功時: { ok: true, account: {id, username, name}, genre_today: {...} }

import { InstagramClient } from "./_instagram.js";
import { genreOfDate } from "./_content.js";

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

export async function onRequestGet({ request, env }) {
  if (!checkAuth(request, env)) {
    return json({ ok: false, message: "Unauthorized" }, 401);
  }

  const status = {
    has_META_APP_ID: Boolean(env.META_APP_ID),
    has_INSTAGRAM_APP_ID: Boolean(env.INSTAGRAM_APP_ID),
    has_INSTAGRAM_APP_SECRET: Boolean(env.INSTAGRAM_APP_SECRET),
    has_INSTAGRAM_BUSINESS_ACCOUNT_ID: Boolean(env.INSTAGRAM_BUSINESS_ACCOUNT_ID),
    has_INSTAGRAM_ACCESS_TOKEN: Boolean(env.INSTAGRAM_ACCESS_TOKEN),
  };

  let account = null;
  let ig_error = null;
  try {
    const ig = new InstagramClient(env);
    account = await ig.me();
  } catch (e) {
    ig_error = e.message;
  }

  return json({
    ok: ig_error === null,
    status,
    account,
    ig_error,
    genre_today: genreOfDate(),
  });
}
