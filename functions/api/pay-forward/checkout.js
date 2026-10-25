// POST /api/pay-forward/checkout
//
// Pay Forward サブスクリプション開始の Checkout Session を Stripe で作成し、
// 遷移先 URL を返す。
//
// リクエスト (JSON):
//   {
//     "service_slug": "hp-starter",
//     "amount": 15000,                     // 顧客希望の月額 (税抜 円)
//     "customer_email": "user@example.com",
//     "customer_name": "山田太郎",         // optional
//     "quote_token": "...",                 // quote_required サービスでは必須
//     "idempotency_key": "..."              // optional, 二重送信防止
//   }
//
// レスポンス:
//   { ok: true, checkout_url: "https://checkout.stripe.com/..." }
//
// サーバー側検証:
//   1. service_slug 存在 & is_published
//   2. 「instant」サービス: 現在の最低料金以上であること
//   3. 「quote_required」サービス: quote_token が有効かつ consumed=false
//      → quote.min_amount 以上であること
//   4. 二重契約防止: 同じ email + service の active subscription 存在チェック
//   5. Stripe Price を顧客ごとに動的作成 → Checkout Session (mode=subscription) 作成
//
// 本実装は Phase 4 で追加します (現在は skeleton)。
// 必要になった時点でこのファイルを完成させます。

import { json, unavailable, isPayForwardEnabled, checkOrigin, validateAmount, fetchService } from "./_shared.js";

export async function onRequestPost({ request, env }) {
  if (!isPayForwardEnabled(env)) return unavailable();
  if (!checkOrigin(request)) return json({ ok: false, message: "Origin not allowed" }, 403);

  // === Phase 4 で実装予定の流れ (疑似コード) ===
  //
  // const payload = await request.json();
  // const service = await fetchService(env.TUSG_DB, payload.service_slug);
  // if (!service) return json({ ok: false, message: "service not found" }, 404);
  //
  // let minAmount;
  // let quoteId = null;
  // if (service.service_type === "quote_required") {
  //   // トークン検証: 発行済み & 未消費 & 期限内 のレコードを探す
  //   const quote = await env.TUSG_DB
  //     .prepare(`SELECT * FROM customer_quotes
  //               WHERE access_token = ? AND status = 'issued' AND expires_at > ?`)
  //     .bind(payload.quote_token, Date.now()).first();
  //   if (!quote || quote.service_id !== service.id) {
  //     return json({ ok: false, message: "invalid or expired quote token" }, 403);
  //   }
  //   if (quote.customer_email.toLowerCase() !== payload.customer_email.toLowerCase()) {
  //     return json({ ok: false, message: "email mismatch" }, 403);
  //   }
  //   minAmount = quote.min_amount;
  //   quoteId = quote.id;
  // } else {
  //   const rule = await fetchCurrentPricingRule(env.TUSG_DB, service.id);
  //   minAmount = rule?.min_amount ?? service.default_min_amount;
  //   if (minAmount == null) return json({ ok: false, message: "service not priced yet" }, 503);
  // }
  //
  // const check = validateAmount(payload.amount, minAmount);
  // if (!check.ok) return json({ ok: false, message: check.message }, 400);
  //
  // // 二重契約防止
  // ...
  //
  // // Stripe Customer, Price, Checkout Session 作成
  // ...
  //
  // return json({ ok: true, checkout_url: session.url });

  return json({
    ok: false,
    status: "not_implemented",
    message: "Checkout endpoint will be enabled in Phase 4 after Stripe account setup.",
  }, 501);
}
