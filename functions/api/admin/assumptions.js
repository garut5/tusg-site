// GET /api/admin/assumptions          — 現在の全体適用前提値を取得
// PUT /api/admin/assumptions           — 複数キーを一括更新
//
// 想定キー (全体適用: service_id = NULL):
//   hourly_rate_jpy, profit_margin, churn_rate_monthly,
//   expected_customers_year1, cost_buffer, stripe_fee_jp_card,
//   stripe_fee_billing, contract_amortization_months,
//   infra_monthly_base_jpy, tax_rate
//
// 値は TEXT (将来、サービス別の override も入れやすくするため文字列保存)。
// 更新は "新規行を INSERT (effective_from = now)" で履歴を残す形。
// 取得は "最新 effective_from" のレコードを採用。

import { json, requireAdmin, dbRequired, readJson, logAudit } from "./_auth.js";

const KNOWN_KEYS = new Set([
  "hourly_rate_jpy",
  "profit_margin",
  "churn_rate_monthly",
  "expected_customers_year1",
  "cost_buffer",
  "stripe_fee_jp_card",
  "stripe_fee_billing",
  "contract_amortization_months",
  "infra_monthly_base_jpy",
  "tax_rate",
]);

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  // 全体適用 (service_id IS NULL) の各キーの最新値を取得
  const rows = await env.TUSG_DB
    .prepare(
      `SELECT key, value, effective_from, notes
       FROM cost_assumptions
       WHERE service_id IS NULL
       ORDER BY effective_from DESC`
    )
    .all();

  // キーごとに最初に出てくる = 最新
  const latest = {};
  for (const r of rows.results || []) {
    if (!latest[r.key]) latest[r.key] = r;
  }

  const assumptions = {};
  for (const key of KNOWN_KEYS) {
    assumptions[key] = latest[key] || null;
  }
  return json({ ok: true, assumptions });
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  let body;
  try { body = await readJson(request); }
  catch (e) { return json({ ok: false, message: e.message }, 400); }

  const updates = body?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return json({ ok: false, message: "updates array required" }, 400);
  }

  const now = Date.now();
  const applied = [];
  const errors = [];

  for (const u of updates) {
    if (!KNOWN_KEYS.has(u.key)) {
      errors.push({ key: u.key, error: "unknown key" });
      continue;
    }
    if (typeof u.value !== "string" && typeof u.value !== "number") {
      errors.push({ key: u.key, error: "value must be string or number" });
      continue;
    }
    const value = String(u.value).trim();
    if (!value) { errors.push({ key: u.key, error: "value is empty" }); continue; }
    if (value.length > 100) { errors.push({ key: u.key, error: "value too long" }); continue; }

    try {
      await env.TUSG_DB
        .prepare(
          `INSERT INTO cost_assumptions (service_id, key, value, effective_from, notes)
           VALUES (NULL, ?, ?, ?, ?)`
        )
        .bind(u.key, value, now, u.notes ? String(u.notes).slice(0, 500) : null)
        .run();
      applied.push({ key: u.key, value });
    } catch (e) {
      errors.push({ key: u.key, error: e.message });
    }
  }

  await logAudit(env, request, {
    admin_email: auth.email,
    action: "assumptions.update",
    target_type: "cost_assumptions",
    payload: { applied, errors },
  });

  return json({ ok: errors.length === 0, applied, errors });
}
