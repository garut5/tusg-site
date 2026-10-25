// GET  /api/admin/services                       — 全サービス一覧 (非公開含む)
// POST /api/admin/services                       — 新規作成
// PATCH /api/admin/services?id=<id>              — 更新
// DELETE /api/admin/services?id=<id>             — 削除 (関連レコードも cascade)
//
// GET  /api/admin/services?id=<id>&with=costs    — 1 サービス + 原価明細
//
// POST /api/admin/services?id=<id>&op=add_cost   — 原価項目を追加
// DELETE /api/admin/services?cost_id=<cid>       — 原価項目を削除

import { json, requireAdmin, dbRequired, readJson, logAudit, trimStr } from "./_auth.js";

const VALID_SERVICE_TYPES = new Set(["instant", "quote_required"]);
const VALID_COST_CATEGORIES = new Set([
  "infra_monthly", "variable", "labor_initial", "labor_monthly",
  "payment_fee", "other",
]);
const VALID_UNITS = new Set([
  "monthly", "per_customer_month", "per_transaction", "one_time", "hourly",
]);

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const withCosts = url.searchParams.get("with") === "costs";

  if (id) {
    const svc = await env.TUSG_DB
      .prepare("SELECT * FROM services WHERE id = ?")
      .bind(id).first();
    if (!svc) return json({ ok: false, message: "service not found" }, 404);
    let costs = [];
    if (withCosts) {
      const now = Date.now();
      const r = await env.TUSG_DB
        .prepare(
          `SELECT * FROM service_costs
           WHERE service_id = ?
             AND (effective_to IS NULL OR effective_to > ?)
           ORDER BY cost_category, item_name`
        )
        .bind(id, now).all();
      costs = r.results || [];
    }
    return json({ ok: true, service: svc, costs });
  }

  const rows = await env.TUSG_DB
    .prepare("SELECT * FROM services ORDER BY sort_order ASC, id ASC")
    .all();
  return json({ ok: true, services: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const op = url.searchParams.get("op");

  // 原価項目追加
  if (id && op === "add_cost") return addCost(request, env, auth, id);

  // 新規サービス作成
  let body;
  try { body = await readJson(request); }
  catch (e) { return json({ ok: false, message: e.message }, 400); }

  const slug = trimStr(body.slug, 50);
  const name = trimStr(body.name, 100);
  const service_type = trimStr(body.service_type, 20);
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(slug)) {
    return json({ ok: false, message: "slug: lowercase alphanumeric + hyphen, start with alnum" }, 400);
  }
  if (!name) return json({ ok: false, message: "name is required" }, 400);
  if (!VALID_SERVICE_TYPES.has(service_type)) {
    return json({ ok: false, message: "service_type must be instant or quote_required" }, 400);
  }

  const now = Date.now();
  try {
    const r = await env.TUSG_DB
      .prepare(
        `INSERT INTO services
           (slug, name, short_description, long_description, service_type,
            default_min_amount, recommended_amount, is_published, sort_order,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .bind(
        slug, name,
        trimStr(body.short_description, 500),
        trimStr(body.long_description, 5000),
        service_type,
        body.default_min_amount != null ? Math.trunc(Number(body.default_min_amount)) : null,
        body.recommended_amount != null ? Math.trunc(Number(body.recommended_amount)) : null,
        Number.isInteger(body.sort_order) ? body.sort_order : 100,
        now, now,
      )
      .run();
    await logAudit(env, request, {
      admin_email: auth.email,
      action: "service.create",
      target_type: "service",
      target_id: r.meta?.last_row_id,
      payload: { slug, name, service_type },
    });
    return json({ ok: true, id: r.meta?.last_row_id, slug });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return json({ ok: false, message: "slug already exists" }, 409);
    }
    return json({ ok: false, message: e.message }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const auth = requireAdmin(request, env);
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
  const map = {
    name: (v) => trimStr(v, 100),
    short_description: (v) => trimStr(v, 500),
    long_description: (v) => trimStr(v, 5000),
    recommended_amount: (v) => v == null ? null : Math.trunc(Number(v)),
    default_min_amount: (v) => v == null ? null : Math.trunc(Number(v)),
    sort_order: (v) => Number.isInteger(v) ? v : 100,
    is_published: (v) => v ? 1 : 0,
  };
  for (const [key, transform] of Object.entries(map)) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(transform(body[key]));
    }
  }
  if (sets.length === 0) return json({ ok: false, message: "no fields to update" }, 400);

  sets.push("updated_at = ?");
  vals.push(Date.now());
  vals.push(id);

  try {
    const r = await env.TUSG_DB
      .prepare(`UPDATE services SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...vals).run();
    if (!r.success || r.meta?.changes === 0) {
      return json({ ok: false, message: "service not found" }, 404);
    }
    await logAudit(env, request, {
      admin_email: auth.email,
      action: "service.update",
      target_type: "service",
      target_id: id,
      payload: body,
    });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const auth = requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const costId = url.searchParams.get("cost_id");

  if (costId) {
    const r = await env.TUSG_DB
      .prepare("DELETE FROM service_costs WHERE id = ?")
      .bind(costId).run();
    if (r.meta?.changes === 0) return json({ ok: false, message: "cost not found" }, 404);
    await logAudit(env, request, {
      admin_email: auth.email,
      action: "service_cost.delete",
      target_type: "service_cost",
      target_id: costId,
    });
    return json({ ok: true });
  }

  if (!id) return json({ ok: false, message: "id or cost_id required" }, 400);

  // サブスクが紐付いているサービスは削除禁止 (非公開化で代用)
  const subUse = await env.TUSG_DB
    .prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE service_id = ?")
    .bind(id).first();
  if ((subUse?.c || 0) > 0) {
    return json({ ok: false, message: "service has active subscriptions; unpublish instead of delete" }, 409);
  }

  const r = await env.TUSG_DB
    .prepare("DELETE FROM services WHERE id = ?")
    .bind(id).run();
  if (r.meta?.changes === 0) return json({ ok: false, message: "service not found" }, 404);

  await logAudit(env, request, {
    admin_email: auth.email,
    action: "service.delete",
    target_type: "service",
    target_id: id,
  });
  return json({ ok: true });
}

// --- 内部: 原価項目追加 ---
async function addCost(request, env, auth, serviceId) {
  let body;
  try { body = await readJson(request); }
  catch (e) { return json({ ok: false, message: e.message }, 400); }

  if (!VALID_COST_CATEGORIES.has(body.cost_category)) {
    return json({ ok: false, message: "invalid cost_category" }, 400);
  }
  const item_name = trimStr(body.item_name, 100);
  if (!item_name) return json({ ok: false, message: "item_name required" }, 400);
  if (body.unit != null && !VALID_UNITS.has(body.unit)) {
    return json({ ok: false, message: "invalid unit" }, 400);
  }
  const now = Date.now();
  try {
    const r = await env.TUSG_DB
      .prepare(
        `INSERT INTO service_costs
          (service_id, cost_category, item_name, amount, rate, unit, hours,
           source, verified_at, effective_from, effective_to, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .bind(
        serviceId,
        body.cost_category,
        item_name,
        body.amount != null ? Math.trunc(Number(body.amount)) : null,
        body.rate != null ? Number(body.rate) : null,
        body.unit || null,
        body.hours != null ? Number(body.hours) : null,
        trimStr(body.source, 500),
        now, now,
        trimStr(body.notes, 500),
      )
      .run();
    await logAudit(env, request, {
      admin_email: auth.email,
      action: "service_cost.create",
      target_type: "service_cost",
      target_id: r.meta?.last_row_id,
      payload: { service_id: serviceId, item_name, cost_category: body.cost_category },
    });
    return json({ ok: true, id: r.meta?.last_row_id });
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }
}
