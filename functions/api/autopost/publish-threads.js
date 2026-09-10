// POST /api/autopost/publish-threads
//
// Threads 版投稿エンドポイント。Instagram 用の publish.js と分離。
//
// 認証: Authorization: Bearer <AUTOPOST_TRIGGER_TOKEN>
//
// リクエスト (JSON):
//   共通:
//     "mode": "text" | "image" | "video" | "carousel"    // default "text"
//     "title": "見出し"
//     "body": "本文"
//     "genre_key": "..."                                 // 省略時は今日の曜日から
//     "dry_run": true
//
//   text モード: (追加パラメータなし)
//   image モード: "image_url"
//   video モード: "video_url"
//   carousel モード: "items": [{"image_url"}/{"video_url"}, ...]
//     ※ 互換: "image_urls": [...] も受付
//
// Threads はキャプション上限 500 文字なので、buildCaption の結果が長すぎる場合は
// 切り詰めた版を返す (省略記号 … 付き)。

import { ThreadsClient } from "./_threads.js";
import { genreOfDate, GENRES, buildCaption } from "./_content.js";

const MAX_BODY_BYTES = 32 * 1024;
const VALID_MODES = new Set(["text", "image", "video", "carousel"]);
const THREADS_TEXT_MAX = 500;

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

async function readJson(request) {
  const ct = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!ct.includes("application/json")) throw new Error("Content-Type must be application/json");
  const cl = Number(request.headers.get("Content-Length") || 0);
  if (cl > MAX_BODY_BYTES) throw new Error("Payload too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Payload too large");
  try { return JSON.parse(text); } catch { throw new Error("Invalid JSON"); }
}

function resolveGenre(payload) {
  if (payload.genre_key) {
    for (const [wd, g] of Object.entries(GENRES)) {
      if (g.key === payload.genre_key) return { weekday: wd, ...g };
    }
    return { key: payload.genre_key, label: payload.genre_key };
  }
  return genreOfDate();
}

function truncateForThreads(text) {
  if (text.length <= THREADS_TEXT_MAX) return text;
  // 3 は "…" (省略記号 1 文字だが安全側で 3 バイト分マージン)
  return text.slice(0, THREADS_TEXT_MAX - 3) + "…";
}

function normalizeCarouselItems(payload) {
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.image_urls)) return payload.image_urls.map((u) => ({ image_url: u }));
  return null;
}

export async function onRequestPost({ request, env }) {
  if (!checkAuth(request, env)) return json({ ok: false, message: "Unauthorized" }, 401);

  let payload;
  try {
    payload = await readJson(request);
  } catch (e) {
    return json({ ok: false, message: e.message }, 400);
  }

  const mode = VALID_MODES.has(payload.mode) ? payload.mode : "text";
  const genre = resolveGenre(payload);

  // Threads 用に短めのキャプションを組む: 見出しと本文と CTA URL のみ、ハッシュタグは削る
  const fullText = buildCaption({
    title: payload.title || genre.label,
    body: payload.body || "",
    genreKey: genre.key,
  });
  const text = truncateForThreads(fullText);

  if (payload.dry_run) {
    return json({
      ok: true,
      dry_run: true,
      mode,
      genre,
      text_preview: text,
      truncated: fullText.length !== text.length,
      original_length: fullText.length,
      final_length: text.length,
    });
  }

  let client;
  try {
    client = new ThreadsClient(env);
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }

  try {
    let result;
    switch (mode) {
      case "text":
        result = await client.publishText({ text });
        break;
      case "image":
        if (!payload.image_url) return json({ ok: false, message: "image_url required" }, 400);
        result = await client.publishImage({ image_url: payload.image_url, text });
        break;
      case "video":
        if (!payload.video_url) return json({ ok: false, message: "video_url required" }, 400);
        result = await client.publishVideo({ video_url: payload.video_url, text });
        break;
      case "carousel": {
        const items = normalizeCarouselItems(payload);
        if (!items || items.length < 2) {
          return json({ ok: false, message: "items (>=2) required for carousel" }, 400);
        }
        result = await client.publishCarousel({ items, text });
        break;
      }
      default:
        return json({ ok: false, message: `unknown mode: ${mode}` }, 400);
    }
    return json({
      ok: true,
      mode,
      genre,
      text_preview: text,
      media_id: result.media_id,
    });
  } catch (e) {
    return json({ ok: false, message: e.message }, 502);
  }
}
