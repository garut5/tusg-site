// GET /api/pay-forward/quote?id=<uuid>&token=<access_token>
//
// 顧客向けエンドポイント。発行された個別見積トークンを検証し、
// 対応するサービス情報と最低料金を返す (apply.html の quote モード表示用)。
//
// 返却:
//   { ok: true, quote: {...}, service: {...} }
//
// 無効時:
//   { ok: false, message: "..." } 403/404/410
//
// Basic 認証対象 (functions/_middleware.js でカバー)。
// ただし公開準備が完了し middleware が外れた時は、トークンそのものが
// アクセス制御の役割を果たす (256bit 相当のランダムトークン)。

import { json, isPayForwardEnabled, unavailable } from "./_shared.js";

function trim(v, max = 128) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

export async function onRequestGet({ request, env }) {
  if (!isPayForwardEnabled(env)) return unavailable();

  const url = new URL(request.url);
  const id = trim(url.searchParams.get("id"), 64);
  const token = trim(url.searchParams.get("token"), 128);
  if (!id || !token) return json({ ok: false, message: "id and token required" }, 400);

  const row = await env.TUSG_DB
    .prepare(
      `SELECT q.id, q.service_id, q.customer_email, q.customer_name, q.customer_company,
              q.min_amount, q.recommended_amount, q.scope_description,
              q.status, q.expires_at, q.access_token,
              s.slug AS service_slug, s.name AS service_name, s.short_description,
              s.service_type
       FROM customer_quotes q
       JOIN services s ON s.id = q.service_id
       WHERE q.id = ? LIMIT 1`
    )
    .bind(id)
    .first();

  if (!row) return json({ ok: false, message: "quote not found" }, 404);
  if (row.access_token !== token) {
    return json({ ok: false, message: "invalid token" }, 403);
  }
  if (row.status !== "issued") {
    return json({ ok: false, message: `quote is ${row.status}` }, 410);
  }
  if (Number(row.expires_at) < Date.now()) {
    return json({ ok: false, message: "quote has expired" }, 410);
  }

  return json({
    ok: true,
    quote: {
      id: row.id,
      customer_email: row.customer_email,
      customer_name: row.customer_name,
      customer_company: row.customer_company,
      min_amount: row.min_amount,
      recommended_amount: row.recommended_amount,
      scope_description: row.scope_description,
      expires_at: row.expires_at,
    },
    service: {
      slug: row.service_slug,
      name: row.service_name,
      short_description: row.short_description,
      service_type: row.service_type,
    },
  });
}
