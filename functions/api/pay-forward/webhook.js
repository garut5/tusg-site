// POST /api/pay-forward/webhook
//
// Stripe Webhook エンドポイント。
//
// 処理イベント:
//   - checkout.session.completed       → customers / subscriptions INSERT (upsert)
//                                        quote_required なら customer_quotes.status='consumed'
//   - customer.subscription.updated    → status / current_amount / next_billing_at 同期
//   - customer.subscription.deleted    → status='canceled', canceled_at 設定
//   - invoice.payment_succeeded        → payments INSERT (succeeded)
//   - invoice.payment_failed           → payments INSERT (failed)
//
// 冪等性: stripe_events.id (event.id) で既処理チェック
//
// 署名検証: Stripe-Signature ヘッダを TUSG_STRIPE_WEBHOOK_SECRET で HMAC-SHA256 検証
//   許容時刻差: ±300 秒

import { json } from "./_shared.js";

const SIG_TOLERANCE_SEC = 300;

export async function onRequestPost({ request, env }) {
  const webhookSecret = env.TUSG_STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Webhook シークレット未設定時は Stripe 側のリトライを止めるため 200 返却
    return json({ ok: true, status: "skipped", reason: "webhook secret not configured" }, 200);
  }

  const rawBody = await request.text();
  const sigHeader = request.headers.get("Stripe-Signature") || "";

  const verify = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  if (!verify.ok) {
    return json({ ok: false, message: `Signature verification failed: ${verify.reason}` }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, message: "Invalid JSON body" }, 400);
  }

  if (!event?.id || !event?.type) {
    return json({ ok: false, message: "Invalid event format" }, 400);
  }

  const db = env.TUSG_DB;
  if (!db) {
    // D1 未バインド時も Stripe 側のリトライは止めたいので 200
    return json({ ok: true, status: "skipped", reason: "db not bound" }, 200);
  }

  // 冪等性チェック
  const already = await db
    .prepare(`SELECT id FROM stripe_events WHERE id = ? LIMIT 1`)
    .bind(event.id)
    .first();
  if (already) {
    return json({ ok: true, status: "already_processed", event_id: event.id }, 200);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(db, event, env);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(db, event);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(db, event, env);
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePaid(db, event, "succeeded", env);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaid(db, event, "failed", env);
        break;
      default:
        // 対象外イベントも event id を記録して重複処理を避ける
        break;
    }
  } catch (e) {
    // 失敗時は event を未記録のまま 500 を返し、Stripe のリトライに任せる
    return json({ ok: false, message: `Handler error: ${e.message}` }, 500);
  }

  await db
    .prepare(
      `INSERT INTO stripe_events (id, type, processed_at, payload)
       VALUES (?, ?, ?, ?)`
    )
    .bind(event.id, event.type, Date.now(), JSON.stringify(event).slice(0, 100000))
    .run();

  return json({ ok: true, event_id: event.id, type: event.type }, 200);
}

// -----------------------------------------------------------------------------
// 署名検証
// -----------------------------------------------------------------------------
async function verifyStripeSignature(payload, header, secret) {
  if (!header) return { ok: false, reason: "missing header" };
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return i < 0 ? [kv, ""] : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return { ok: false, reason: "malformed header" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - t) > SIG_TOLERANCE_SEC) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const signedPayload = `${t}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const expected = toHex(new Uint8Array(sig));

  if (!timingSafeEqualHex(expected, v1)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

function toHex(bytes) {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += chars[(bytes[i] >> 4) & 0xf] + chars[bytes[i] & 0xf];
  }
  return s;
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const la = a.length;
  const lb = b.length;
  let diff = la ^ lb;
  const maxLen = Math.max(la, lb, 1);
  for (let i = 0; i < maxLen; i++) {
    const ca = i < la ? a.charCodeAt(i) : 0;
    const cb = i < lb ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

// -----------------------------------------------------------------------------
// Shape helpers: Stripe API 2024-12-18.acacia (旧) と 2025+ 以降の両方に対応
//   - invoice.subscription (string) → invoice.parent.subscription_details.subscription
//   - invoice.charge (string)        → removed → payment_intent 系から参照
//   - subscription.current_period_end → subscription.items.data[0].current_period_end
// -----------------------------------------------------------------------------
function extractIdOrString(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.id === "string") return v.id;
  return null;
}
function invoiceSubscriptionId(inv) {
  return extractIdOrString(inv?.subscription)
    || extractIdOrString(inv?.parent?.subscription_details?.subscription)
    || extractIdOrString(inv?.lines?.data?.[0]?.subscription)
    || extractIdOrString(inv?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription)
    || null;
}
function invoiceChargeId(inv) {
  return extractIdOrString(inv?.charge)
    || extractIdOrString(inv?.payments?.data?.[0]?.payment?.payment_intent)
    || null;
}
function subscriptionCurrentPeriodEnd(sub) {
  if (!sub) return null;
  if (sub.current_period_end) return Number(sub.current_period_end);
  const items = sub.items?.data || [];
  for (const it of items) {
    if (it?.current_period_end) return Number(it.current_period_end);
  }
  return null;
}
function subscriptionCurrentPeriodStart(sub) {
  if (!sub) return null;
  if (sub.current_period_start) return Number(sub.current_period_start);
  const items = sub.items?.data || [];
  for (const it of items) {
    if (it?.current_period_start) return Number(it.current_period_start);
  }
  return null;
}

// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------

async function upsertCustomer(db, stripeCustomerId, email, name, company) {
  const now = Date.now();
  const existing = await db
    .prepare(`SELECT id FROM customers WHERE stripe_customer_id = ? LIMIT 1`)
    .bind(stripeCustomerId)
    .first();
  if (existing?.id) {
    await db
      .prepare(
        `UPDATE customers SET email = COALESCE(?, email),
                              name = COALESCE(?, name),
                              company = COALESCE(?, company),
                              updated_at = ?
         WHERE id = ?`
      )
      .bind(email || null, name || null, company || null, now, existing.id)
      .run();
    return existing.id;
  }
  const r = await db
    .prepare(
      `INSERT INTO customers (stripe_customer_id, email, name, company, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(stripeCustomerId, email || "", name || null, company || null, now, now)
    .run();
  return r.meta?.last_row_id;
}

async function handleCheckoutCompleted(db, event, env) {
  const session = event.data.object;
  if (session.mode !== "subscription") return;
  const subscriptionId = extractIdOrString(session.subscription);
  if (!subscriptionId) return; // Stripe 側で未確定ならスキップ

  const md = session.metadata || {};
  const subMd = session.subscription_data?.metadata || {};
  const service_id = Number(md.service_id || subMd.service_id);
  const quote_id = md.quote_id || subMd.quote_id || null;
  const min_amount_at_contract = Number(md.min_amount_at_contract || subMd.min_amount_at_contract || 0);
  const customer_email = (md.customer_email || subMd.customer_email || session.customer_details?.email || "").toLowerCase();

  // customer upsert
  const customerLocalId = await upsertCustomer(
    db,
    extractIdOrString(session.customer),
    customer_email,
    session.customer_details?.name,
    null
  );

  // Stripe から subscription 詳細を取得 (price_id / current_amount / status / current_period_end)
  const sub = await fetchStripeSubscription(env, subscriptionId);
  const stripePriceId = sub.items?.data?.[0]?.price?.id || "";
  const unitAmount = Number(sub.items?.data?.[0]?.price?.unit_amount || 0);
  const now = Date.now();
  const cpeSec = subscriptionCurrentPeriodEnd(sub);
  const nextBilling = cpeSec ? cpeSec * 1000 : null;

  // subscriptions INSERT (ユニークインデックス重複は無視)
  try {
    await db
      .prepare(
        `INSERT INTO subscriptions
          (stripe_subscription_id, customer_id, service_id, quote_id,
           min_amount_at_contract, current_amount, stripe_price_id, status,
           started_at, next_billing_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        sub.id, customerLocalId, service_id || null, quote_id || null,
        min_amount_at_contract || unitAmount, unitAmount, stripePriceId, sub.status || "active",
        sub.start_date ? sub.start_date * 1000 : now, nextBilling, now, now
      )
      .run();
  } catch (e) {
    // 既存 (再送等) の場合は UPDATE
    await db
      .prepare(
        `UPDATE subscriptions
         SET status = ?, current_amount = ?, stripe_price_id = ?,
             next_billing_at = ?, updated_at = ?
         WHERE stripe_subscription_id = ?`
      )
      .bind(sub.status || "active", unitAmount, stripePriceId, nextBilling, now, sub.id)
      .run();
  }

  // quote を consumed に
  if (quote_id) {
    await db
      .prepare(
        `UPDATE customer_quotes
         SET status = 'consumed', consumed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'issued'`
      )
      .bind(now, now, quote_id)
      .run();
  }

  // ── 通知 ──
  // サービス情報と顧客情報を取得して admin と顧客にメール
  const svcRow = service_id
    ? await db.prepare("SELECT name, slug FROM services WHERE id = ?").bind(service_id).first()
    : null;
  const svcName = svcRow?.name || "(サービス未リンク)";
  const custName = session.customer_details?.name || "";

  // 失敗しても webhook 自体は成功させる (Stripe の retry を発生させない)
  try {
    await sendAdminNewContractNotice(env, {
      customer_name: custName,
      customer_email,
      service_name: svcName,
      amount_monthly: unitAmount,
      min_amount_at_contract: min_amount_at_contract || unitAmount,
      stripe_subscription_id: sub.id,
      stripe_customer_id: extractIdOrString(session.customer),
    });
  } catch (e) {
    console.error("[webhook] admin notify (new contract) failed:", e?.message || e);
  }
  try {
    await sendCustomerWelcomeNotice(env, {
      to: customer_email,
      customer_name: custName,
      service_name: svcName,
      amount_monthly: unitAmount,
    });
  } catch (e) {
    console.error("[webhook] customer welcome failed:", e?.message || e);
  }
}

async function handleSubscriptionUpdated(db, event) {
  const sub = event.data.object;
  const now = Date.now();
  const unitAmount = Number(sub.items?.data?.[0]?.price?.unit_amount || 0);
  const cpeSec = subscriptionCurrentPeriodEnd(sub);
  const nextBilling = cpeSec ? cpeSec * 1000 : null;
  const canceled = sub.canceled_at ? sub.canceled_at * 1000 : null;
  const cape = sub.cancel_at_period_end ? 1 : 0;

  await db
    .prepare(
      `UPDATE subscriptions
       SET status = ?, current_amount = CASE WHEN ? > 0 THEN ? ELSE current_amount END,
           stripe_price_id = COALESCE(?, stripe_price_id),
           next_billing_at = ?,
           canceled_at = ?,
           cancel_at_period_end = ?,
           updated_at = ?
       WHERE stripe_subscription_id = ?`
    )
    .bind(
      sub.status || "active",
      unitAmount, unitAmount,
      sub.items?.data?.[0]?.price?.id || null,
      nextBilling, canceled, cape, now,
      sub.id
    )
    .run();
}

async function handleSubscriptionDeleted(db, event, env) {
  const sub = event.data.object;
  const now = Date.now();
  await db
    .prepare(
      `UPDATE subscriptions
       SET status = 'canceled', canceled_at = ?, updated_at = ?
       WHERE stripe_subscription_id = ?`
    )
    .bind(now, now, sub.id)
    .run();

  // 解約を admin に通知 (累計収益も算出して添える)
  const row = await db
    .prepare(
      `SELECT s.id, s.current_amount, s.min_amount_at_contract, s.started_at,
              c.email, c.name AS customer_name, c.company,
              sv.name AS service_name,
              (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE subscription_id = s.id AND status = 'succeeded') AS total_revenue
       FROM subscriptions s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN services sv ON sv.id = s.service_id
       WHERE s.stripe_subscription_id = ? LIMIT 1`
    )
    .bind(sub.id).first();
  if (row) {
    try {
      await sendAdminCancellationNotice(env, {
        customer_name: row.customer_name,
        customer_email: row.email,
        service_name: row.service_name,
        amount_monthly: row.current_amount,
        duration_days: Math.max(0, Math.floor((now - Number(row.started_at)) / 86400000)),
        total_revenue: Number(row.total_revenue || 0),
        stripe_subscription_id: sub.id,
      });
    } catch (e) {
      console.error("[webhook] admin notify (cancellation) failed:", e?.message || e);
    }
  }
}

async function handleInvoicePaid(db, event, status, env) {
  const inv = event.data.object;
  const now = Date.now();
  const stripeSubId = invoiceSubscriptionId(inv);
  let subLocalId = null;
  if (stripeSubId) {
    const r = await db
      .prepare(`SELECT id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1`)
      .bind(stripeSubId)
      .first();
    subLocalId = r?.id || null;
  }

  const amount = Number(inv.amount_paid || inv.amount_due || 0);
  const paidAt = inv.status_transitions?.paid_at
    ? inv.status_transitions.paid_at * 1000
    : (status === "succeeded" ? now : null);
  const failureReason = inv.last_finalization_error?.message
    || inv.last_payment_error?.message
    || null;
  const chargeId = invoiceChargeId(inv);

  // UNIQUE(stripe_invoice_id) に INSERT; 重複時は UPDATE
  try {
    await db
      .prepare(
        `INSERT INTO payments
          (subscription_id, stripe_invoice_id, stripe_charge_id, amount, currency,
           status, failure_reason, paid_at, created_at, raw_event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        subLocalId, inv.id, chargeId, amount, (inv.currency || "jpy").toUpperCase(),
        status, failureReason, paidAt, now, event.id
      )
      .run();
  } catch {
    await db
      .prepare(
        `UPDATE payments
         SET status = ?, failure_reason = ?, paid_at = COALESCE(?, paid_at), raw_event_id = ?
         WHERE stripe_invoice_id = ?`
      )
      .bind(status, failureReason, paidAt, event.id, inv.id)
      .run();
  }

  // 失敗時は必ず admin 通知 (見逃すとビジネス直撃)
  // 成功時も通知する (運用の可視化。頻度が多すぎれば将来フィルタ可)
  if (subLocalId) {
    const info = await db
      .prepare(
        `SELECT c.email, c.name AS customer_name, c.company, sv.name AS service_name,
                s.current_amount, s.stripe_subscription_id
         FROM subscriptions s
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN services sv ON sv.id = s.service_id
         WHERE s.id = ? LIMIT 1`
      )
      .bind(subLocalId).first();
    if (info) {
      try {
        await sendAdminPaymentNotice(env, {
          status,
          customer_name: info.customer_name,
          customer_email: info.email,
          service_name: info.service_name,
          amount,
          current_monthly: info.current_amount,
          failure_reason: failureReason,
          stripe_invoice_id: inv.id,
          stripe_subscription_id: info.stripe_subscription_id,
          hosted_invoice_url: inv.hosted_invoice_url || null,
        });
      } catch (e) {
        console.error("[webhook] admin notify (payment " + status + ") failed:", e?.message || e);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Stripe API: subscription 詳細取得
// -----------------------------------------------------------------------------
async function fetchStripeSubscription(env, subId) {
  const resp = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
    headers: {
      Authorization: `Bearer ${env.TUSG_STRIPE_SECRET_KEY}`,
      "Stripe-Version": env.STRIPE_API_VERSION || "2024-12-18.acacia",
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Stripe subscription fetch failed (${resp.status}): ${body.slice(0, 500)}`);
  }
  return resp.json();
}

// -----------------------------------------------------------------------------
// Resend 通知 (admin / 顧客)
//
// 「お客様が課金しても気づかないリスク」を排除するため、以下を必ず飛ばす:
//   - 新規契約成立 → admin + 顧客 welcome
//   - 月次決済 (成功/失敗) → admin
//   - 解約 → admin
//
// RESEND_API_KEY / RESEND_FROM_EMAIL が未設定の場合は no-op (エラーログのみ)
// 送信失敗は webhook 自体の再送を防ぐため throw せず warn で握る (呼び出し側で try/catch)
// -----------------------------------------------------------------------------
function yen(n) { return "¥" + Number(n || 0).toLocaleString("ja-JP"); }
function adminEmail(env) {
  return env.ADMIN_ALERT_EMAIL || env.CONSULTATION_NOTIFICATION_TO || env.CONTACT_TO_EMAIL;
}
function senderFrom(env) {
  if (!env.RESEND_FROM_EMAIL) return null;
  return env.RESEND_FROM_NAME
    ? `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`
    : env.RESEND_FROM_EMAIL;
}
async function sendResend(env, { to, subject, text, replyTo }) {
  const apiKey = env.RESEND_API_KEY;
  const from = senderFrom(env);
  if (!apiKey || !from || !to) {
    console.warn("[webhook] resend skipped (missing config or recipient)",
      { has_apiKey: Boolean(apiKey), has_from: Boolean(from), has_to: Boolean(to) });
    return;
  }
  const body = { from, to: Array.isArray(to) ? to : [to], subject, text };
  if (replyTo) body.reply_to = replyTo;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Resend ${resp.status}: ${err.slice(0, 300)}`);
  }
}

async function sendAdminNewContractNotice(env, d) {
  const to = adminEmail(env);
  const siteUrl = (env.SITE_URL || "https://tusg.co.jp").replace(/\/$/, "");
  const lines = [
    "🎉 Pay Forward 新規契約が成立しました。",
    "",
    `顧客:   ${d.customer_name || "(氏名未入力)"} <${d.customer_email}>`,
    `サービス: ${d.service_name}`,
    `月額:    ${yen(d.amount_monthly)} / 月 (税抜)`,
    `契約時最低額: ${yen(d.min_amount_at_contract)} (snapshot — 下振れ赤字防止ガード)`,
    "",
    `Stripe Subscription: ${d.stripe_subscription_id}`,
    `Stripe Customer:     ${d.stripe_customer_id || "(不明)"}`,
    "",
    "────────────────",
    `管理画面で契約詳細: ${siteUrl}/admin/#subscriptions`,
    `Stripe で管理:        https://dashboard.stripe.com/customers/${d.stripe_customer_id || ""}`,
  ].join("\n");
  await sendResend(env, {
    to,
    subject: `【Pay Forward 新規契約】${d.service_name}｜${d.customer_name || d.customer_email}｜${yen(d.amount_monthly)}/月`,
    text: lines,
    replyTo: d.customer_email,
  });
}

async function sendCustomerWelcomeNotice(env, d) {
  const siteUrl = (env.SITE_URL || "https://tusg.co.jp").replace(/\/$/, "");
  const lines = [
    `${d.customer_name || "お客様"} 様`,
    "",
    "合同会社TUSG です。この度は Pay Forward のご契約、誠にありがとうございます。",
    "",
    `サービス: ${d.service_name}`,
    `月額: ${yen(d.amount_monthly)} / 月 (税抜)`,
    "",
    "決済は Stripe を通じて自動で行われ、レシートが別途 Stripe から送信されます。",
    "月額料金はお客様ご自身でいつでも変更・解約いただけます (別途ご案内予定)。",
    "",
    "ご不明点がございましたら、このメールにご返信ください。",
    "",
    "────────────────",
    "合同会社TUSG",
    siteUrl,
  ].join("\n");
  await sendResend(env, {
    to: d.to,
    subject: `【TUSG】ご契約ありがとうございます (${d.service_name})`,
    text: lines,
    replyTo: adminEmail(env),
  });
}

async function sendAdminPaymentNotice(env, d) {
  const to = adminEmail(env);
  const siteUrl = (env.SITE_URL || "https://tusg.co.jp").replace(/\/$/, "");
  const isFailed = d.status === "failed";
  const emoji = isFailed ? "⚠️" : "💴";
  const label = isFailed ? "決済失敗" : "決済成功";
  const lines = [
    `${emoji} Pay Forward ${label}`,
    "",
    `顧客:   ${d.customer_name || "(氏名未入力)"} <${d.customer_email}>`,
    `サービス: ${d.service_name}`,
    `請求額:  ${yen(d.amount)}`,
    `現在月額: ${yen(d.current_monthly)}`,
    isFailed ? `失敗理由: ${d.failure_reason || "(詳細は Stripe ダッシュボードで確認)"}` : null,
    "",
    `Stripe Invoice: ${d.stripe_invoice_id}`,
    `Stripe Subscription: ${d.stripe_subscription_id}`,
    d.hosted_invoice_url ? `Invoice URL: ${d.hosted_invoice_url}` : null,
    "",
    "────────────────",
    isFailed
      ? "対応: Stripe はしばらく自動で再試行します。顧客に連絡して決済手段の確認を依頼してください。"
      : "D1 の payments テーブルに記録済み。",
    `管理画面: ${siteUrl}/admin/#subscriptions`,
  ].filter((l) => l != null).join("\n");
  await sendResend(env, {
    to,
    subject: `${emoji}【Pay Forward ${label}】${d.customer_name || d.customer_email}｜${yen(d.amount)}`,
    text: lines,
    replyTo: d.customer_email,
  });
}

async function sendAdminCancellationNotice(env, d) {
  const to = adminEmail(env);
  const siteUrl = (env.SITE_URL || "https://tusg.co.jp").replace(/\/$/, "");
  const lines = [
    "📉 Pay Forward 契約が解約されました。",
    "",
    `顧客:   ${d.customer_name || "(氏名未入力)"} <${d.customer_email}>`,
    `サービス: ${d.service_name}`,
    `契約時月額: ${yen(d.amount_monthly)}`,
    `契約期間:  ${d.duration_days} 日`,
    `累計収益:  ${yen(d.total_revenue)}`,
    "",
    `Stripe Subscription: ${d.stripe_subscription_id}`,
    "",
    "────────────────",
    "対応: 必要に応じて解約理由のヒアリング・改善施策を検討してください。",
    `管理画面: ${siteUrl}/admin/#subscriptions`,
  ].join("\n");
  await sendResend(env, {
    to,
    subject: `📉【Pay Forward 解約】${d.customer_name || d.customer_email}｜${d.service_name}`,
    text: lines,
    replyTo: d.customer_email,
  });
}
