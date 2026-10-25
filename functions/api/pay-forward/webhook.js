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
        await handleSubscriptionDeleted(db, event);
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePaid(db, event, "succeeded");
        break;
      case "invoice.payment_failed":
        await handleInvoicePaid(db, event, "failed");
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
  if (!session.subscription) return; // Stripe 側で未確定ならスキップ

  const md = session.metadata || {};
  const subMd = session.subscription_data?.metadata || {};
  const service_id = Number(md.service_id || subMd.service_id);
  const quote_id = md.quote_id || subMd.quote_id || null;
  const min_amount_at_contract = Number(md.min_amount_at_contract || subMd.min_amount_at_contract || 0);
  const customer_email = (md.customer_email || subMd.customer_email || session.customer_details?.email || "").toLowerCase();

  // customer upsert
  const customerLocalId = await upsertCustomer(
    db,
    session.customer,
    customer_email,
    session.customer_details?.name,
    null
  );

  // Stripe から subscription 詳細を取得 (price_id / current_amount / status / current_period_end)
  const sub = await fetchStripeSubscription(env, session.subscription);
  const stripePriceId = sub.items?.data?.[0]?.price?.id || "";
  const unitAmount = Number(sub.items?.data?.[0]?.price?.unit_amount || 0);
  const now = Date.now();
  const nextBilling = sub.current_period_end ? sub.current_period_end * 1000 : null;

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
}

async function handleSubscriptionUpdated(db, event) {
  const sub = event.data.object;
  const now = Date.now();
  const unitAmount = Number(sub.items?.data?.[0]?.price?.unit_amount || 0);
  const nextBilling = sub.current_period_end ? sub.current_period_end * 1000 : null;
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

async function handleSubscriptionDeleted(db, event) {
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
}

async function handleInvoicePaid(db, event, status) {
  const inv = event.data.object;
  const now = Date.now();
  const stripeSubId = inv.subscription;
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
  const chargeId = inv.charge || null;

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
