// GET /api/admin/subscriptions
//   クエリ: ?status=active|canceled|all&limit=100
//   顧客 + サービス + 最新決済を JOIN して返す
//
// GET /api/admin/subscriptions?id=<local_id>
//   単一契約の詳細 (支払履歴・料金変更履歴も含む)

import { json, requireAdmin, dbRequired } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) return await handleDetail(env, id);
  return await handleList(env, url);
}

async function handleList(env, url) {
  const status = url.searchParams.get("status") || "all";
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));

  let where = "";
  const params = [];
  if (status === "active") {
    where = "WHERE s.status IN ('active','trialing','past_due')";
  } else if (status && status !== "all") {
    where = "WHERE s.status = ?";
    params.push(status);
  }

  const rows = await env.TUSG_DB
    .prepare(
      `SELECT
         s.id, s.stripe_subscription_id, s.customer_id, s.service_id, s.quote_id,
         s.min_amount_at_contract, s.current_amount, s.stripe_price_id,
         s.status, s.started_at, s.canceled_at, s.cancel_at_period_end,
         s.next_billing_at, s.created_at, s.updated_at,
         c.email AS customer_email, c.name AS customer_name, c.company AS customer_company,
         c.stripe_customer_id,
         sv.slug AS service_slug, sv.name AS service_name, sv.service_type
       FROM subscriptions s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN services sv ON sv.id = s.service_id
       ${where}
       ORDER BY s.started_at DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  // サマリ (status 別件数、現在月額合計)
  const summary = await env.TUSG_DB
    .prepare(
      `SELECT status, COUNT(*) AS count, SUM(current_amount) AS total_mrr
       FROM subscriptions GROUP BY status`
    )
    .all();

  return json({
    ok: true,
    subscriptions: rows.results || [],
    summary: summary.results || [],
  });
}

async function handleDetail(env, id) {
  const sub = await env.TUSG_DB
    .prepare(
      `SELECT s.*, c.email AS customer_email, c.name AS customer_name,
              c.company AS customer_company, c.stripe_customer_id,
              sv.slug AS service_slug, sv.name AS service_name, sv.service_type
       FROM subscriptions s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN services sv ON sv.id = s.service_id
       WHERE s.id = ? LIMIT 1`
    )
    .bind(id).first();
  if (!sub) return json({ ok: false, message: "subscription not found" }, 404);

  const payments = await env.TUSG_DB
    .prepare(
      `SELECT id, stripe_invoice_id, stripe_charge_id, amount, currency,
              status, failure_reason, paid_at, created_at
       FROM payments
       WHERE subscription_id = ?
       ORDER BY created_at DESC LIMIT 100`
    )
    .bind(sub.id).all();

  const priceHistory = await env.TUSG_DB
    .prepare(
      `SELECT id, old_amount, new_amount, changed_at, changed_by,
              stripe_price_id_old, stripe_price_id_new, reason
       FROM pricing_history
       WHERE subscription_id = ?
       ORDER BY changed_at DESC`
    )
    .bind(sub.id).all();

  // 関連 quote (quote_required 契約の場合)
  let quote = null;
  if (sub.quote_id) {
    quote = await env.TUSG_DB
      .prepare(`SELECT * FROM customer_quotes WHERE id = ? LIMIT 1`)
      .bind(sub.quote_id).first();
  }

  return json({
    ok: true,
    subscription: sub,
    payments: payments.results || [],
    pricing_history: priceHistory.results || [],
    quote,
  });
}
