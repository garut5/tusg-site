// POST /api/autopost/scheduled
//
// tusg-autopost-cron Worker から毎日 20:00 JST に叩かれるエンドポイント。
// 今日のジャンルを判定して、ジャンル別の default 画像 + キャプションで 1 投稿する。
//
// Body (JSON, 任意):
//   { "dry_run": true, "source": "cron:..." | "manual" }
//
// レスポンス: publish.js と同じ形式
//
// テンプレ画像:
//   デフォルトは placehold.co の TUSG グリーン + ジャンル名。
//   R2 にジャンル別テンプレを配置したら env.ASSETS_BASE_URL を経由して差し替え。
//   R2 バケット規約: {ASSETS_BASE_URL}/genre/{genre_key}.jpg

import { InstagramClient } from "./_instagram.js";
import { genreOfDate, buildCaption, assertCaption } from "./_content.js";

const DEFAULT_BODIES = {
  meo: "Google マップの順位、店舗運営に効いていますか？MEO は「地図で見つけてもらう」ための土台です。",
  aio: "AI 時代、店舗の情報は AI にも「見つけてもらう」設計が必要です。AIO の考え方をご紹介。",
  operation_tech: "紙・Excel・LINE 中心の運用を、少しだけ仕組み化すると現場のストレスが減ります。",
  web_dev: "既製ツールでは届かないところに、自社独自の業務システムが効くケース。",
  hp_growth: "ホームページを持っているのに集客につながらない場合、導線設計に穴があることが多いです。",
  pitfalls: "IT 導入でよくある失敗パターン。「入れて終わり」は再現性なく現場が使い続けられません。",
  tusg_way: "TUSG は「本当にお客様のためになる仕組み」を選び、伴走します。",
};

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

// R2 にジャンル別テンプレ画像が上がっていればそれを使う、なければ placehold.co フォールバック
async function resolveTemplateImageUrl(genreKey, env, request) {
  const key = `genre/${genreKey}.jpg`;
  if (env.AUTOPOST_ASSETS) {
    try {
      const head = await env.AUTOPOST_ASSETS.head(key);
      if (head) {
        const base = env.SITE_URL || `${new URL(request.url).protocol}//${new URL(request.url).host}`;
        return `${base.replace(/\/$/, "")}/assets/${key}`;
      }
    } catch {
      // R2 head 失敗時は placehold へフォールバック
    }
  }
  const asciiLabel = ({
    meo: "MEO", aio: "AIO", operation_tech: "SHOP+TECH", web_dev: "WEB",
    hp_growth: "HP", pitfalls: "PITFALLS", tusg_way: "TUSG",
  })[genreKey] || "TUSG";
  return `https://placehold.co/1080x1080/0F3D2E/FFFFFF/png?text=${asciiLabel}`;
}

export async function onRequestPost({ request, env }) {
  if (!checkAuth(request, env)) return json({ ok: false, message: "Unauthorized" }, 401);

  let body = {};
  try {
    if ((request.headers.get("Content-Type") || "").includes("application/json")) {
      body = await request.json();
    }
  } catch {
    // 空 body でも動く
  }

  const genre = genreOfDate();
  const bodyText = DEFAULT_BODIES[genre.key] || "本日の投稿です。";
  let caption;
  try {
    caption = buildCaption({
      title: genre.label,
      body: bodyText,
      genreKey: genre.key,
    });
    assertCaption(caption);
  } catch (e) {
    return json({ ok: false, message: `caption error: ${e.message}` }, 500);
  }

  const image_url = await resolveTemplateImageUrl(genre.key, env, request);

  if (body.dry_run) {
    return json({
      ok: true,
      dry_run: true,
      source: body.source || "unknown",
      genre,
      image_url,
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
    const result = await client.publishSingle({ image_url, caption });
    return json({
      ok: true,
      source: body.source || "unknown",
      genre,
      image_url,
      caption_preview: caption,
      media_id: result.media_id,
    });
  } catch (e) {
    return json({ ok: false, message: e.message, genre, image_url }, 502);
  }
}
