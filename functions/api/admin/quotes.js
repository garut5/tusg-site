// GET  /api/admin/quotes                — 一覧 (新しい順)
// POST /api/admin/quotes                — 発行 (quote_required サービス用)
// PATCH /api/admin/quotes?id=<id>&op=revoke  — 失効

import { json, requireAdmin, dbRequired, readJson, logAudit, trimStr } from "./_auth.js";

function randomToken() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
function uuid() {
  return crypto.randomUUID();
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  let query = `
    SELECT q.*, s.name as service_name, s.slug as service_slug
    FROM customer_quotes q
    LEFT JOIN services s ON s.id = q.service_id
  `;
  const params = [];
  if (status) {
    query += " WHERE q.status = ?";
    params.push(status);
  }
  query += " ORDER BY q.created_at DESC LIMIT 200";

  const rows = await env.TUSG_DB.prepare(query).bind(...params).all();
  return json({ ok: true, quotes: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  let body;
  try { body = await readJson(request); }
  catch (e) { return json({ ok: false, message: e.message }, 400); }

  const service_id = Number(body.service_id);
  if (!Number.isInteger(service_id)) return json({ ok: false, message: "service_id required" }, 400);

  const svc = await env.TUSG_DB.prepare("SELECT * FROM services WHERE id = ?")
    .bind(service_id).first();
  if (!svc) return json({ ok: false, message: "service not found" }, 404);
  if (svc.service_type !== "quote_required") {
    return json({ ok: false, message: "service is not quote_required" }, 400);
  }

  const customer_email = trimStr(body.customer_email, 254);
  if (!customer_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer_email)) {
    return json({ ok: false, message: "valid customer_email required" }, 400);
  }
  const min_amount = Math.trunc(Number(body.min_amount));
  if (!(min_amount >= 100 && min_amount <= 10_000_000)) {
    return json({ ok: false, message: "min_amount must be 100 - 10,000,000" }, 400);
  }
  const recommended_amount = body.recommended_amount != null
    ? Math.trunc(Number(body.recommended_amount)) : null;

  // 有効期限 (デフォルト 30 日)
  const expiresDays = Number.isInteger(body.expires_days) ? body.expires_days : 30;
  if (expiresDays < 1 || expiresDays > 180) {
    return json({ ok: false, message: "expires_days must be 1-180" }, 400);
  }

  const id = uuid();
  const access_token = randomToken();
  const now = Date.now();
  const expires_at = now + expiresDays * 24 * 60 * 60 * 1000;

  await env.TUSG_DB
    .prepare(
      `INSERT INTO customer_quotes
        (id, service_id, customer_email, customer_name, customer_company,
         min_amount, recommended_amount, scope_description, cost_breakdown,
         access_token, status, expires_at, issued_by, issued_at,
         notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, service_id, customer_email,
      trimStr(body.customer_name, 100),
      trimStr(body.customer_company, 100),
      min_amount, recommended_amount,
      trimStr(body.scope_description, 5000),
      body.cost_breakdown ? JSON.stringify(body.cost_breakdown).slice(0, 10000) : null,
      access_token, expires_at, auth.email, now,
      trimStr(body.notes, 1000),
      now, now,
    )
    .run();

  await logAudit(env, request, {
    admin_email: auth.email,
    action: "quote.issue",
    target_type: "customer_quote",
    target_id: id,
    payload: { service_id, customer_email, min_amount },
  });

  // 顧客向けアクセス URL (このリンク + token で /pay-forward/apply にアクセス可能)
  const siteUrl = env.SITE_URL || "https://tusg.co.jp";
  const customer_url = `${siteUrl.replace(/\/$/, "")}/pay-forward/apply?quote=${id}&token=${access_token}`;

  return json({
    ok: true,
    id,
    access_token,
    expires_at,
    customer_url,
    note: "customer_url と access_token は顧客に別経路で安全に送付してください (Resend 自動送信は Phase 4b で実装)",
  });
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const op = url.searchParams.get("op");
  if (!id) return json({ ok: false, message: "id required" }, 400);

  if (op === "revoke") {
    let body = {};
    try { body = await readJson(request); } catch { /* body optional */ }
    const now = Date.now();
    const r = await env.TUSG_DB
      .prepare(
        `UPDATE customer_quotes
         SET status = 'revoked', revoked_at = ?, revoked_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'issued'`
      )
      .bind(now, trimStr(body.reason, 500), now, id).run();
    if (r.meta?.changes === 0) {
      return json({ ok: false, message: "quote not found or not in issued state" }, 404);
    }
    await logAudit(env, request, {
      admin_email: auth.email,
      action: "quote.revoke",
      target_type: "customer_quote",
      target_id: id,
      payload: { reason: body.reason },
    });
    return json({ ok: true });
  }

  return json({ ok: false, message: "unknown op" }, 400);
}
