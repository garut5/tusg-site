// tusg-autopost-cron
//
// 毎日 20:00 JST に起動、本体 Pages Function `POST /api/autopost/scheduled` を叩く。
// この Worker には投稿ロジックを持たせない (叩くだけ)。ジャンル選定・キャプション組立・
// テンプレ画像選択・実 API 呼び出しはすべて本体側。両方に処理を書くとドリフトする。
//
// 安全ゲート:
//   - AUTOPOST_LIVE 環境変数が "true" の時のみ実投稿
//   - それ以外は body.dry_run=true を送るので Meta には何も届かない
//
// 手動テスト:
//   fetch("https://tusg-autopost-cron.<subdomain>.workers.dev/run?key=<TRIGGER_SECRET>")
//   (TRIGGER_SECRET が未設定なら 404 を返す。設定時のみ疎通確認可能)

async function runOnce(env, source) {
  if (!env.AUTOPOST_TRIGGER_TOKEN) {
    return { ok: false, error: "AUTOPOST_TRIGGER_TOKEN is not set on cron worker" };
  }
  const site = (env.SITE_URL || "https://tusg.site").replace(/\/$/, "");
  const dryRun = env.AUTOPOST_LIVE !== "true";

  const body = { dry_run: dryRun, source };
  const res = await fetch(`${site}/api/autopost/scheduled`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.AUTOPOST_TRIGGER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }
  return { ok: res.ok, http: res.status, dryRun, source, response: parsed };
}

export default {
  async scheduled(event, env, ctx) {
    const result = await runOnce(env, `cron:${event.scheduledTime}`);
    console.log(JSON.stringify(result));
    if (!result.ok) {
      // scheduled ハンドラーは throw で Cloudflare 側のリトライ対象になる
      throw new Error(`scheduled run failed: ${JSON.stringify(result).slice(0, 300)}`);
    }
  },

  async fetch(request, env) {
    // 手動トリガー用 (TRIGGER_SECRET が設定されている時のみ有効)
    const url = new URL(request.url);
    if (url.pathname !== "/run") {
      return new Response("Not found", { status: 404 });
    }
    if (!env.TRIGGER_SECRET) {
      return new Response("Manual trigger not enabled (TRIGGER_SECRET unset)", { status: 404 });
    }
    const key = url.searchParams.get("key") || "";
    if (key.length !== env.TRIGGER_SECRET.length ||
        !timingSafeEqual(key, env.TRIGGER_SECRET)) {
      return new Response("Forbidden", { status: 401 });
    }
    const result = await runOnce(env, "manual");
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },
};

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
