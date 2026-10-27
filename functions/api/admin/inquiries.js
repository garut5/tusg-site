// GET  /api/admin/inquiries              — 一覧 (status フィルタ可)
// GET  /api/admin/inquiries?id=<id>      — 単一詳細
// PATCH /api/admin/inquiries?id=<id>     — status / assigned_to / admin_notes / quote_id 更新

import { json, requireAdmin, dbRequired, readJson, logAudit, trimStr } from "./_auth.js";

const ALLOWED_STATUS = new Set(["new", "in_progress", "quoted", "rejected"]);

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    const row = await env.TUSG_DB
      .prepare(
        `SELECT i.*,
                s.name AS service_name, s.slug AS service_slug_current, s.service_type
         FROM pay_forward_inquiries i
         LEFT JOIN services s ON s.id = i.service_id
         WHERE i.id = ? LIMIT 1`
      )
      .bind(id).first();
    if (!row) return json({ ok: false, message: "inquiry not found" }, 404);
    return json({ ok: true, inquiry: row });
  }

  const status = url.searchParams.get("status");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  let where = "";
  const params = [];
  if (status === "open") {
    where = "WHERE i.status IN ('new','in_progress')";
  } else if (status && status !== "all") {
    where = "WHERE i.status = ?";
    params.push(status);
  }
  const rows = await env.TUSG_DB
    .prepare(
      `SELECT i.id, i.service_id, i.service_slug_at_submit,
              i.customer_name, i.customer_email, i.customer_company,
              i.desired_pages, i.budget_feel,
              i.status, i.assigned_to, i.quote_id, i.created_at, i.updated_at,
              s.name AS service_name, s.slug AS service_slug_current, s.service_type
       FROM pay_forward_inquiries i
       LEFT JOIN services s ON s.id = i.service_id
       ${where}
       ORDER BY i.created_at DESC
       LIMIT ?`
    )
    .bind(...params, limit).all();

  const summary = await env.TUSG_DB
    .prepare(`SELECT status, COUNT(*) AS count FROM pay_forward_inquiries GROUP BY status`)
    .all();

  return json({ ok: true, inquiries: rows.results || [], summary: summary.results || [] });
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ ok: false, message: "id required" }, 400);

  let body;
  try { body = await readJson(request); }
  catch (e) { return json({ ok: false, message: e.message }, 400); }

  const sets = [];
  const vals = [];
  if (typeof body.status === "string") {
    if (!ALLOWED_STATUS.has(body.status)) {
      return json({ ok: false, message: "invalid status" }, 400);
    }
    sets.push("status = ?"); vals.push(body.status);
  }
  if (body.assigned_to !== undefined) {
    sets.push("assigned_to = ?"); vals.push(trimStr(body.assigned_to, 254));
  }
  if (body.admin_notes !== undefined) {
    sets.push("admin_notes = ?"); vals.push(trimStr(body.admin_notes, 5000));
  }
  if (body.quote_id !== undefined) {
    sets.push("quote_id = ?"); vals.push(trimStr(body.quote_id, 64));
  }
  if (sets.length === 0) return json({ ok: false, message: "no fields to update" }, 400);
  sets.push("updated_at = ?"); vals.push(Date.now());
  vals.push(id);

  const r = await env.TUSG_DB
    .prepare(`UPDATE pay_forward_inquiries SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals).run();
  if (r.meta?.changes === 0) {
    return json({ ok: false, message: "inquiry not found" }, 404);
  }
  await logAudit(env, request, {
    admin_email: auth.email,
    action: "inquiry.update",
    target_type: "pay_forward_inquiry",
    target_id: id,
    payload: body,
  });
  return json({ ok: true });
}
