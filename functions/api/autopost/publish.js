// POST /api/autopost/publish
//
// TUSG 自社メディア自動投稿エンドポイント。手動 / cron の両方から叩ける。
//
// 認証: リクエストヘッダ `Authorization: Bearer <AUTOPOST_TRIGGER_TOKEN>` 必須。
// トークンは Cloudflare Dashboard で Secret として登録。
//
// リクエスト (JSON):
//   {
//     "mode": "single" | "carousel",       // 省略時 "single"
//     "image_url": "https://...",          // single モード
//     "image_urls": ["https://...", ...],  // carousel モード (2-10 枚)
//     "title": "...",                      // 任意、キャプションの見出し
//     "body": "...",                       // 任意、キャプションの本文
//     "genre_key": "meo" | "aio" | ...,    // 省略時、今日の曜日から自動判定
//     "dry_run": true                      // 検証だけして投稿しない
//   }
//
// 成功時: { ok: true, media_id, genre, caption_preview }
// 失敗時: { ok: false, message, ... }

import { InstagramClient } from "./_instagram.js";
import { genreOfDate, GENRES, buildCaption, assertCaption } from "./_content.js";

const MAX_BODY_BYTES = 32 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function unauthorized() {
  return json({ ok: false, message: "Unauthorized" }, 401);
}

function checkAuth(request, env) {
  const expected = env.AUTOPOST_TRIGGER_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("Authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  return timingSafeEqual(m[1], expected);
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(request) {
  const ct = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    throw new Error("Content-Type must be application/json");
  }
  const cl = Number(request.headers.get("Content-Length") || 0);
  if (cl > MAX_BODY_BYTES) throw new Error("Payload too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Payload too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON");
  }
}

export async function onRequestPost({ request, env }) {
  if (!checkAuth(request, env)) return unauthorized();

  let payload;
  try {
    payload = await readJson(request);
  } catch (e) {
    return json({ ok: false, message: e.message }, 400);
  }

  const mode = payload.mode === "carousel" ? "carousel" : "single";
  const genre = payload.genre_key
    ? { key: payload.genre_key, label: GENRES[weekdayForKey(payload.genre_key)]?.label || payload.genre_key }
    : genreOfDate();

  let caption;
  try {
    caption = buildCaption({
      title: payload.title || genre.label,
      body: payload.body || "",
      genreKey: genre.key,
    });
    assertCaption(caption);
  } catch (e) {
    return json({ ok: false, message: `caption error: ${e.message}` }, 400);
  }

  if (payload.dry_run) {
    return json({
      ok: true,
      dry_run: true,
      mode,
      genre,
      caption_preview: caption,
    });
  }

  let client;
  try {
    client = new InstagramClient(env);
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }

  try {
    let result;
    if (mode === "carousel") {
      if (!Array.isArray(payload.image_urls) || payload.image_urls.length < 2) {
        return json({ ok: false, message: "image_urls (>=2) required for carousel" }, 400);
      }
      result = await client.publishCarousel({
        image_urls: payload.image_urls,
        caption,
      });
    } else {
      if (!payload.image_url) {
        return json({ ok: false, message: "image_url required for single" }, 400);
      }
      result = await client.publishSingle({
        image_url: payload.image_url,
        caption,
      });
    }
    return json({
      ok: true,
      mode,
      genre,
      caption_preview: caption,
      media_id: result.media_id,
    });
  } catch (e) {
    return json({ ok: false, message: e.message }, 502);
  }
}

function weekdayForKey(genreKey) {
  for (const [wd, g] of Object.entries(GENRES)) {
    if (g.key === genreKey) return wd;
  }
  return null;
}
