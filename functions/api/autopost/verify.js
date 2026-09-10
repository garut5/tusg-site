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
import { ThreadsClient } from "./_threads.js";
import { genreOfDate } from "./_content.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function guessTokenType(token) {
  if (!token) return "empty";
  if (token.startsWith("IGAA") || token.startsWith("IGQV")) return "instagram_business_login (graph.instagram.com 用)";
  if (token.startsWith("EAAB") || token.startsWith("EAAG") || token.startsWith("EAA")) return "facebook_graph (graph.facebook.com 用)";
  if (token.length < 50) return "short (トークンではない可能性)";
  return "unknown (フォーマット判定不能)";
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

  const token = env.INSTAGRAM_ACCESS_TOKEN || "";
  const threadsToken = env.THREADS_ACCESS_TOKEN || "";
  const status = {
    // Instagram
    has_META_APP_ID: Boolean(env.META_APP_ID),
    has_INSTAGRAM_APP_ID: Boolean(env.INSTAGRAM_APP_ID),
    has_INSTAGRAM_APP_SECRET: Boolean(env.INSTAGRAM_APP_SECRET),
    has_INSTAGRAM_BUSINESS_ACCOUNT_ID: Boolean(env.INSTAGRAM_BUSINESS_ACCOUNT_ID),
    has_INSTAGRAM_ACCESS_TOKEN: Boolean(token),
    token_length: token.length,
    token_prefix: token.slice(0, 5),
    token_type_guess: guessTokenType(token),
    graph_host: env.INSTAGRAM_GRAPH_HOST || "https://graph.instagram.com (default)",
    // Threads
    has_THREADS_ACCESS_TOKEN: Boolean(threadsToken),
    threads_token_length: threadsToken.length,
    threads_token_prefix: threadsToken.slice(0, 5),
    // Autopost 共通
    has_AUTOPOST_TRIGGER_TOKEN: Boolean(env.AUTOPOST_TRIGGER_TOKEN),
    has_R2_AUTOPOST_ASSETS: Boolean(env.AUTOPOST_ASSETS),
  };

  let account = null;
  let ig_error = null;
  try {
    const ig = new InstagramClient(env);
    account = await ig.me();
  } catch (e) {
    ig_error = e.message;
  }

  let threads_account = null;
  let threads_error = null;
  if (threadsToken) {
    try {
      const t = new ThreadsClient(env);
      threads_account = await t.me();
    } catch (e) {
      threads_error = e.message;
    }
  } else {
    threads_error = "THREADS_ACCESS_TOKEN not set (2 本目 Meta アプリ作成後に設定)";
  }

  return json({
    ok: ig_error === null,
    status,
    instagram: { account, error: ig_error },
    threads: { account: threads_account, error: threads_error },
    genre_today: genreOfDate(),
  });
}
