// POST /api/admin/pricing/calculate?service_id=<id>
//   → 現在の原価と前提値から最低料金を計算。計算根拠付きで返す (保存はしない)
//
// POST /api/admin/pricing/publish?service_id=<id>
//   → 計算結果を pricing_rules に INSERT (effective_from=now)。既存は effective_to=now で close。
//
// GET /api/admin/pricing?service_id=<id>
//   → 当該サービスの pricing_rules 履歴を取得

import { json, requireAdmin, dbRequired, readJson, logAudit } from "./_auth.js";

// 前提値の取得 (sync で揃える)
async function fetchAssumptions(db) {
  const r = await db
    .prepare(
      `SELECT key, value FROM cost_assumptions
       WHERE service_id IS NULL
       ORDER BY effective_from DESC`
    ).all();
  const map = {};
  for (const row of r.results || []) {
    if (!(row.key in map)) map[row.key] = row.value;
  }
  // default fallbacks
  return {
    hourly_rate_jpy: Number(map.hourly_rate_jpy ?? 5000),
    profit_margin: Number(map.profit_margin ?? 0.40),
    churn_rate_monthly: Number(map.churn_rate_monthly ?? 0.03),
    expected_customers_year1: Number(map.expected_customers_year1 ?? 20),
    cost_buffer: Number(map.cost_buffer ?? 0.10),
    stripe_fee_jp_card: Number(map.stripe_fee_jp_card ?? 0.0325),
    stripe_fee_billing: Number(map.stripe_fee_billing ?? 0.005),
    contract_amortization_months: Number(map.contract_amortization_months ?? 36),
    infra_monthly_base_jpy: Number(map.infra_monthly_base_jpy ?? 600),
    tax_rate: Number(map.tax_rate ?? 0.10),
  };
}

async function fetchActiveCosts(db, serviceId) {
  const now = Date.now();
  const r = await db
    .prepare(
      `SELECT * FROM service_costs
       WHERE service_id = ?
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to > ?)`
    )
    .bind(serviceId, now, now).all();
  return r.results || [];
}

/**
 * 最低料金算出アルゴリズム
 *
 * 入力:
 *   assumptions: 全体適用前提値
 *   costs: 当該サービスの cost 項目
 *
 * 計算:
 *   initial_total_cost = Σ labor_initial.(hours × hourly_rate) + Σ labor_initial.amount
 *   initial_amortized_monthly = initial_total_cost / contract_amortization_months
 *
 *   labor_monthly = Σ labor_monthly.(hours × hourly_rate) + Σ labor_monthly.amount
 *
 *   infra_monthly_dedicated = Σ infra_monthly.amount (サービス固有分)
 *   infra_shared_per_customer = assumptions.infra_monthly_base_jpy / expected_customers_year1
 *
 *   variable_per_customer = Σ variable.amount (unit=per_customer_month)
 *
 *   base_cost_per_customer_month =
 *     initial_amortized_monthly +
 *     labor_monthly +
 *     infra_monthly_dedicated +
 *     infra_shared_per_customer +
 *     variable_per_customer
 *
 *   with_margin = base × (1 + profit_margin)
 *   with_buffer = with_margin × (1 + cost_buffer)
 *
 *   payment_fee_rate = stripe_fee_jp_card + stripe_fee_billing (日本カード Visa/MC)
 *   min_price_before_round = with_buffer / (1 - payment_fee_rate)
 *
 *   min_price_jpy (税抜) = Math.ceil(min_price_before_round / 100) × 100
 */
function calculateMinimumPrice(assumptions, costs) {
  const hr = assumptions.hourly_rate_jpy;
  const months = assumptions.contract_amortization_months;

  const breakdown = {
    initial_total: 0,
    initial_amortized_monthly: 0,
    labor_monthly: 0,
    infra_monthly_dedicated: 0,
    infra_shared_per_customer: 0,
    variable_per_customer: 0,
    base_cost_per_customer_month: 0,
    with_margin: 0,
    with_buffer: 0,
    payment_fee_rate: 0,
    min_price_before_round: 0,
    min_price_jpy: 0,
    items: [],
  };

  for (const c of costs) {
    let contribution = 0;
    const amount = Number(c.amount || 0);
    const hours = Number(c.hours || 0);

    switch (c.cost_category) {
      case "labor_initial":
        contribution = hours * hr + amount;
        breakdown.initial_total += contribution;
        break;
      case "labor_monthly":
        contribution = hours * hr + amount;
        breakdown.labor_monthly += contribution;
        break;
      case "infra_monthly":
        contribution = amount;
        breakdown.infra_monthly_dedicated += contribution;
        break;
      case "variable":
        // unit=per_customer_month のみ扱う。per_transaction は payment_fee で処理
        if (c.unit === "per_customer_month" || c.unit === "monthly") {
          contribution = amount;
          breakdown.variable_per_customer += contribution;
        }
        break;
      case "payment_fee":
        // rate ベース (0.03 etc.) は後段で合算
        break;
      case "other":
        // "monthly" ユニットは共通月額扱い、"one_time" は初期費用扱い
        if (c.unit === "monthly") {
          contribution = amount;
          breakdown.infra_monthly_dedicated += contribution;
        } else if (c.unit === "one_time") {
          contribution = amount;
          breakdown.initial_total += contribution;
        }
        break;
    }
    breakdown.items.push({
      id: c.id,
      cost_category: c.cost_category,
      item_name: c.item_name,
      hours, amount,
      contribution_monthly: contribution,
    });
  }

  breakdown.initial_amortized_monthly =
    months > 0 ? breakdown.initial_total / months : 0;

  const expectedCustomers = Math.max(1, assumptions.expected_customers_year1);
  breakdown.infra_shared_per_customer =
    assumptions.infra_monthly_base_jpy / expectedCustomers;

  breakdown.base_cost_per_customer_month =
    breakdown.initial_amortized_monthly +
    breakdown.labor_monthly +
    breakdown.infra_monthly_dedicated +
    breakdown.infra_shared_per_customer +
    breakdown.variable_per_customer;

  breakdown.with_margin =
    breakdown.base_cost_per_customer_month * (1 + assumptions.profit_margin);
  breakdown.with_buffer =
    breakdown.with_margin * (1 + assumptions.cost_buffer);

  breakdown.payment_fee_rate =
    assumptions.stripe_fee_jp_card + assumptions.stripe_fee_billing;

  const feeDenom = Math.max(0.01, 1 - breakdown.payment_fee_rate);
  breakdown.min_price_before_round = breakdown.with_buffer / feeDenom;
  breakdown.min_price_jpy = Math.ceil(breakdown.min_price_before_round / 100) * 100;

  // 丸めで細かい数値を整える
  for (const key of [
    "initial_amortized_monthly", "infra_shared_per_customer",
    "base_cost_per_customer_month", "with_margin", "with_buffer",
    "min_price_before_round",
  ]) {
    breakdown[key] = Math.round(breakdown[key] * 100) / 100;
  }

  return breakdown;
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const serviceId = url.searchParams.get("service_id");
  if (!serviceId) return json({ ok: false, message: "service_id required" }, 400);

  const action = url.pathname.endsWith("/publish") ? "publish" : "calculate";

  const svc = await env.TUSG_DB.prepare("SELECT * FROM services WHERE id = ?")
    .bind(serviceId).first();
  if (!svc) return json({ ok: false, message: "service not found" }, 404);

  const assumptions = await fetchAssumptions(env.TUSG_DB);
  const costs = await fetchActiveCosts(env.TUSG_DB, serviceId);
  const breakdown = calculateMinimumPrice(assumptions, costs);

  if (action === "calculate") {
    return json({ ok: true, service: { id: svc.id, slug: svc.slug, name: svc.name }, assumptions, breakdown });
  }

  // publish: 既存ルールを close し、新ルールを INSERT
  const now = Date.now();
  await env.TUSG_DB
    .prepare(`UPDATE pricing_rules SET effective_to = ? WHERE service_id = ? AND effective_to IS NULL`)
    .bind(now, serviceId).run();

  const basisJson = JSON.stringify({ assumptions, breakdown });
  const r = await env.TUSG_DB
    .prepare(
      `INSERT INTO pricing_rules
         (service_id, min_amount, calculation_basis, effective_from, effective_to, created_by, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`
    )
    .bind(serviceId, breakdown.min_price_jpy, basisJson, now, auth.email, now)
    .run();

  await logAudit(env, request, {
    admin_email: auth.email,
    action: "pricing_rule.publish",
    target_type: "pricing_rule",
    target_id: r.meta?.last_row_id,
    payload: { service_id: serviceId, min_amount: breakdown.min_price_jpy },
  });

  return json({ ok: true, published: true, min_amount: breakdown.min_price_jpy, breakdown });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const dbErr = dbRequired(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const serviceId = url.searchParams.get("service_id");
  if (!serviceId) return json({ ok: false, message: "service_id required" }, 400);

  const rows = await env.TUSG_DB
    .prepare(
      `SELECT id, min_amount, effective_from, effective_to, created_by, created_at
       FROM pricing_rules
       WHERE service_id = ?
       ORDER BY effective_from DESC`
    )
    .bind(serviceId).all();
  return json({ ok: true, history: rows.results || [] });
}
