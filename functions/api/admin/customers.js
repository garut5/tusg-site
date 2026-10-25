// GET /api/admin/customers
//   顧客一覧 (email で検索可: ?q=foo)
//
// GET /api/admin/customers?id=<local_id>
//   単一顧客の詳細 (契約一覧も含む)

import { json, requireAdmin, dbRequired } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    const c = await env.TUSG_DB
      .prepare(`SELECT * FROM customers WHERE id = ? LIMIT 1`)
      .bind(id).first();
    if (!c) return json({ ok: false, message: "customer not found" }, 404);
    const subs = await env.TUSG_DB
      .prepare(
        `SELECT s.*, sv.name AS service_name, sv.slug AS service_slug
         FROM subscriptions s
         LEFT JOIN services sv ON sv.id = s.service_id
         WHERE s.customer_id = ? ORDER BY s.started_at DESC`
      )
      .bind(id).all();
    return json({ ok: true, customer: c, subscriptions: subs.results || [] });
  }

  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  let rows;
  if (q) {
    rows = await env.TUSG_DB
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM subscriptions WHERE customer_id = c.id) AS sub_count,
                (SELECT COUNT(*) FROM subscriptions
                   WHERE customer_id = c.id AND status IN ('active','trialing','past_due')) AS active_count
         FROM customers c
         WHERE lower(c.email) LIKE ? OR lower(c.name) LIKE ? OR lower(c.company) LIKE ?
         ORDER BY c.created_at DESC LIMIT 300`
      )
      .bind(`%${q}%`, `%${q}%`, `%${q}%`).all();
  } else {
    rows = await env.TUSG_DB
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM subscriptions WHERE customer_id = c.id) AS sub_count,
                (SELECT COUNT(*) FROM subscriptions
                   WHERE customer_id = c.id AND status IN ('active','trialing','past_due')) AS active_count
         FROM customers c
         ORDER BY c.created_at DESC LIMIT 300`
      ).all();
  }

  return json({ ok: true, customers: rows.results || [] });
}
