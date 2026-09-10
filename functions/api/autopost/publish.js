// POST /api/autopost/publish
//
// TUSG 自社メディア自動投稿エンドポイント。手動 / cron の両方から叩ける。
//
// 認証: リクエストヘッダ `Authorization: Bearer <AUTOPOST_TRIGGER_TOKEN>` 必須。
//
// リクエスト (JSON):
//   共通:
//     "mode": "single" | "carousel" | "reel" | "story"    // default "single"
//     "title": "見出し"                                    // 任意、キャプション見出し
//     "body": "本文"                                       // 任意、キャプション本文
//     "genre_key": "meo" | "aio" | ...                    // 省略時、今日の曜日から自動判定
//     "dry_run": true                                     // 検証だけして投稿しない
//
//   single モード:
//     "image_url": "https://..."
//
//   carousel モード:
//     "items": [{"image_url": "..."} or {"video_url": "..."}, ...]  // 2-10 個
//     ※ 互換: "image_urls": ["...", ...] 形式も受付
//
//   reel モード (縦動画、9:16 推奨):
//     "video_url": "https://..."
//     "share_to_feed": true  // フィードにも表示 (default true)
//     "cover_url": "https://..."   // サムネイル指定 (任意)
//     "thumb_offset": 3000         // 動画内サムネ位置 ms (任意)
//
//   story モード:
//     "image_url": "..." or "video_url": "..."   // どちらか
//
// 成功時: { ok: true, media_id, mode, genre, caption_preview }
// 失敗時: { ok: false, message, ... }

import { InstagramClient } from "./_instagram.js";
import { genreOfDate, GENRES, buildCaption, assertCaption } from "./_content.js";

const MAX_BODY_BYTES = 32 * 1024;
const VALID_MODES = new Set(["single", "carousel", "reel", "story"]);

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

function resolveGenre(payload) {
  if (payload.genre_key) {
    const weekday = weekdayForKey(payload.genre_key);
    if (weekday) return { weekday, ...GENRES[weekday] };
    return { key: payload.genre_key, label: payload.genre_key };
  }
  return genreOfDate();
}

function weekdayForKey(genreKey) {
  for (const [wd, g] of Object.entries(GENRES)) {
    if (g.key === genreKey) return wd;
  }
  return null;
}

// story モードはキャプションが付かないので簡略化
function needsCaption(mode) {
  return mode !== "story";
}

// carousel の payload 正規化 (旧 image_urls 形式もサポート)
function normalizeCarouselItems(payload) {
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.image_urls)) {
    return payload.image_urls.map((u) => ({ image_url: u }));
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  if (!checkAuth(request, env)) return unauthorized();

  let payload;
  try {
    payload = await readJson(request);
  } catch (e) {
    return json({ ok: false, message: e.message }, 400);
  }

  const mode = VALID_MODES.has(payload.mode) ? payload.mode : "single";
  const genre = resolveGenre(payload);

  let caption = "";
  if (needsCaption(mode)) {
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
  }

  if (payload.dry_run) {
    return json({
      ok: true,
      dry_run: true,
      mode,
      genre,
      caption_preview: caption,
      note: mode === "story" ? "story はキャプション無し" : undefined,
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
    switch (mode) {
      case "single": {
        if (!payload.image_url) {
          return json({ ok: false, message: "image_url required for single" }, 400);
        }
        result = await client.publishSingle({ image_url: payload.image_url, caption });
        break;
      }
      case "carousel": {
        const items = normalizeCarouselItems(payload);
        if (!items || items.length < 2) {
          return json({ ok: false, message: "items (>=2) required for carousel" }, 400);
        }
        result = await client.publishCarousel({ items, caption });
        break;
      }
      case "reel": {
        if (!payload.video_url) {
          return json({ ok: false, message: "video_url required for reel" }, 400);
        }
        result = await client.publishReel({
          video_url: payload.video_url,
          caption,
          share_to_feed: payload.share_to_feed,
          cover_url: payload.cover_url,
          thumb_offset: payload.thumb_offset,
        });
        break;
      }
      case "story": {
        if (!payload.image_url && !payload.video_url) {
          return json({ ok: false, message: "image_url or video_url required for story" }, 400);
        }
        result = await client.publishStory({
          image_url: payload.image_url,
          video_url: payload.video_url,
        });
        break;
      }
      default:
        return json({ ok: false, message: `unknown mode: ${mode}` }, 400);
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
