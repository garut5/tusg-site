// GET /api/pay-forward/services
//
// 公開中サービスの一覧 + 各サービスの現時点の最低料金を返す。
// LP ページ (/pay-forward.html) のサービスカード描画用。
//
// レスポンス:
//   {
//     ok: true,
//     services: [
//       {
//         slug, name, short_description, service_type,
//         min_amount, recommended_amount
//       },
//       ...
//     ]
//   }
//
// 未有効化時 (D1 や Stripe が未設定) は 503 を返す。

import { json, unavailable, isPayForwardEnabled, fetchCurrentPricingRule } from "./_shared.js";

export async function onRequestGet({ env }) {
  if (!isPayForwardEnabled(env)) return unavailable();

  const db = env.TUSG_DB;
  const rows = await db
    .prepare(
      `SELECT id, slug, name, short_description, service_type,
              default_min_amount, recommended_amount, sort_order
       FROM services
       WHERE is_published = 1
       ORDER BY sort_order ASC, id ASC`
    )
    .all();

  const services = [];
  for (const r of rows.results || []) {
    const rule = await fetchCurrentPricingRule(db, r.id);
    services.push({
      slug: r.slug,
      name: r.name,
      short_description: r.short_description,
      service_type: r.service_type,
      min_amount: rule?.min_amount ?? r.default_min_amount ?? null,
      recommended_amount: r.recommended_amount,
    });
  }

  return json({ ok: true, services });
}
