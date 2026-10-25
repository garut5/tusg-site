// POST /api/pay-forward/webhook
//
// Stripe からのイベント通知受信口。
// Phase 4 で以下を処理:
//   - checkout.session.completed       → subscriptions テーブル INSERT + customer_quotes.status='consumed'
//   - customer.subscription.updated    → status / current_amount 同期
//   - customer.subscription.deleted    → status='canceled' 更新
//   - invoice.payment_succeeded        → payments テーブル INSERT (succeeded)
//   - invoice.payment_failed           → payments テーブル INSERT (failed), 管理者通知
//
// 冪等性: event.id を stripe_events テーブルで既処理チェック
//
// 署名検証:
//   - Stripe-Signature ヘッダを TUSG_STRIPE_WEBHOOK_SECRET で検証
//   - Workers 環境では Node の crypto モジュールは使えないため Web Crypto API 使用
//
// 本実装は Phase 4 で追加します (現在は skeleton)。

import { json, isPayForwardEnabled } from "./_shared.js";

export async function onRequestPost({ request, env }) {
  if (!isPayForwardEnabled(env)) {
    // webhook は Stripe 側に 2xx を返さないと再送されるため、
    // 無効化時は 200 + skipped で返す (後で有効化してから手動で event を再送してもらう)
    return json({ ok: true, status: "skipped", reason: "pay forward not enabled" }, 200);
  }

  // === Phase 4 で実装予定 ===
  //
  // 1. Stripe-Signature ヘッダから署名を取り出す
  // 2. body を text() で生取得
  // 3. HMAC-SHA256(body, TUSG_STRIPE_WEBHOOK_SECRET) で検証
  // 4. JSON パース → event
  // 5. stripe_events.id の既存チェック (冪等)
  // 6. event.type に応じ D1 を更新
  // 7. event.id を stripe_events に INSERT
  // 8. 200 OK を返す

  return json({
    ok: false,
    status: "not_implemented",
    message: "Webhook handler will be enabled in Phase 4.",
  }, 501);
}
