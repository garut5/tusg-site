// POST /api/pay-forward/checkout
//
// Pay Forward サブスクリプション開始の Checkout Session を Stripe で作成し、
// 遷移先 URL を返す。
//
// リクエスト (JSON):
//   {
//     "service_slug": "hp-1p",
//     "amount": 15000,                     // 顧客希望の月額 (税抜 円)
//     "customer_email": "user@example.com",
//     "customer_name": "山田太郎",         // optional
//     "customer_company": "株式会社サンプル", // optional
//     "quote_token": "...",                 // quote_required サービスでは必須
//     "quote_id": "...",                    // quote_required サービスでは必須
//     "promotion_code": "TEST100"          // optional (100%割引テストクーポン等)
//   }
//
// レスポンス:
//   { ok: true, checkout_url: "https://checkout.stripe.com/..." }
//
// サーバー側検証 (下振れ赤字防止):
//   1. service_slug 存在 & is_published
//   2. 「instant」: 現在の最低料金 (pricing_rules) 以上であること
//   3. 「quote_required」: quote_token/quote_id が issued & 未期限切れ & email 一致
//                         → quote.min_amount 以上であること
//   4. 二重契約防止: 同じ email の active subscription 存在チェック
//   5. Stripe Price を顧客の希望額で動的作成 → Checkout Session (mode=subscription)

import {
  json, unavailable, isPayForwardEnabled, checkOrigin, validateAmount,
  fetchService, fetchCurrentPricingRule,
} from "./_shared.js";

const STRIPE_API = "https://api.stripe.com/v1";

function trimStr(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function isValidEmail(email) {
  if (typeof email !== "string") return false;
  if (email.length > 254) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

// Stripe REST API 呼び出し (application/x-www-form-urlencoded)
async function stripe(env, path, params, method = "POST") {
  const headers = {
    Authorization: `Bearer ${env.TUSG_STRIPE_SECRET_KEY}`,
    "Stripe-Version": env.STRIPE_API_VERSION || "2024-12-18.acacia",
  };
  const init = { method, headers };
  if (params && method !== "GET") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = encodeForm(params);
  }
  const url = method === "GET" && params
    ? `${STRIPE_API}${path}?${encodeForm(params)}`
    : `${STRIPE_API}${path}`;
  const resp = await fetch(url, init);
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = body?.error || {};
    const msg = err.message || `Stripe ${method} ${path} failed (${resp.status})`;
    const e = new Error(msg);
    e.stripe_code = err.code;
    e.stripe_type = err.type;
    e.http_status = resp.status;
    throw e;
  }
  return body;
}

function encodeForm(params) {
  const parts = [];
  function enc(key, val) {
    if (val == null) return;
    if (Array.isArray(val)) {
      val.forEach((v, i) => enc(`${key}[${i}]`, v));
    } else if (typeof val === "object") {
      for (const k of Object.keys(val)) enc(`${key}[${k}]`, val[k]);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }
  }
  for (const k of Object.keys(params)) enc(k, params[k]);
  return parts.join("&");
}

export async function onRequestPost({ request, env }) {
  if (!isPayForwardEnabled(env)) return unavailable();
  if (!checkOrigin(request)) return json({ ok: false, message: "Origin not allowed" }, 403);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: "Invalid JSON body" }, 400);
  }

  const service_slug = trimStr(payload.service_slug, 80);
  if (!service_slug) return json({ ok: false, message: "service_slug required" }, 400);

  const customer_email = trimStr(payload.customer_email, 254);
  if (!isValidEmail(customer_email)) return json({ ok: false, message: "valid customer_email required" }, 400);

  const customer_name = trimStr(payload.customer_name, 100);
  const customer_company = trimStr(payload.customer_company, 100);
  const promotion_code = trimStr(payload.promotion_code, 100);

  const db = env.TUSG_DB;

  // 1. サービス取得
  const service = await fetchService(db, service_slug);
  if (!service) return json({ ok: false, message: "service not found or not published" }, 404);

  // 2. 最低額の決定
  let minAmount = null;
  let quoteRow = null;

  if (service.service_type === "quote_required") {
    const quote_token = trimStr(payload.quote_token, 128);
    const quote_id = trimStr(payload.quote_id, 64);
    if (!quote_token || !quote_id) {
      return json({ ok: false, message: "quote_id and quote_token required for this service" }, 403);
    }
    quoteRow = await db
      .prepare(`SELECT * FROM customer_quotes WHERE id = ? LIMIT 1`)
      .bind(quote_id)
      .first();
    if (!quoteRow || quoteRow.access_token !== quote_token) {
      return json({ ok: false, message: "invalid quote credentials" }, 403);
    }
    if (quoteRow.service_id !== service.id) {
      return json({ ok: false, message: "quote does not match this service" }, 403);
    }
    if (quoteRow.status !== "issued") {
      return json({ ok: false, message: `quote is ${quoteRow.status}, not usable` }, 403);
    }
    if (Number(quoteRow.expires_at) < Date.now()) {
      return json({ ok: false, message: "quote has expired" }, 403);
    }
    if (String(quoteRow.customer_email).toLowerCase() !== customer_email.toLowerCase()) {
      return json({ ok: false, message: "email does not match quote" }, 403);
    }
    minAmount = Number(quoteRow.min_amount);
  } else {
    const rule = await fetchCurrentPricingRule(db, service.id);
    minAmount = rule?.min_amount != null
      ? Number(rule.min_amount)
      : (service.default_min_amount != null ? Number(service.default_min_amount) : null);
    if (minAmount == null || !Number.isFinite(minAmount)) {
      return json({ ok: false, message: "service is not priced yet" }, 503);
    }
  }

  // 3. 金額バリデーション
  const check = validateAmount(payload.amount, minAmount);
  if (!check.ok) return json({ ok: false, message: check.message }, 400);
  const amount = check.amount;

  // 4. 二重契約防止 (同 email × 同 service × active 状態)
  const dupCheck = await db
    .prepare(
      `SELECT s.id FROM subscriptions s
       JOIN customers c ON c.id = s.customer_id
       WHERE lower(c.email) = ? AND s.service_id = ?
         AND s.status IN ('active','trialing','past_due')
       LIMIT 1`
    )
    .bind(customer_email.toLowerCase(), service.id)
    .first();
  if (dupCheck) {
    return json({ ok: false, message: "An active subscription already exists for this email and service" }, 409);
  }

  // 5. Stripe 側: 既存 customer を email で検索 or 新規作成
  let stripeCustomerId;
  const existingCustomer = await db
    .prepare(`SELECT stripe_customer_id FROM customers WHERE lower(email) = ? LIMIT 1`)
    .bind(customer_email.toLowerCase())
    .first();

  if (existingCustomer?.stripe_customer_id) {
    stripeCustomerId = existingCustomer.stripe_customer_id;
  } else {
    try {
      const metadata = { source: "pay-forward", site: "tusg.co.jp" };
      if (customer_company) metadata.company = customer_company;
      const created = await stripe(env, "/customers", {
        email: customer_email,
        name: customer_name || undefined,
        metadata,
      });
      stripeCustomerId = created.id;
    } catch (e) {
      return json({ ok: false, message: `Stripe customer create failed: ${e.message}` }, 502);
    }
  }

  // 6. Stripe Price を顧客の希望額で動的作成 (月額、JPY)
  //    product は service.slug ベースの共通 product を lookup or create
  let productId;
  try {
    const productLookup = await stripe(env, "/products/search", {
      query: `metadata['service_slug']:'${service.slug}'`,
    }, "GET");
    if (productLookup?.data?.[0]?.id) {
      productId = productLookup.data[0].id;
    } else {
      const prod = await stripe(env, "/products", {
        name: `TUSG Pay Forward: ${service.name}`,
        metadata: { service_slug: service.slug, service_id: String(service.id) },
      });
      productId = prod.id;
    }
  } catch (e) {
    return json({ ok: false, message: `Stripe product resolve failed: ${e.message}` }, 502);
  }

  let priceId;
  try {
    const price = await stripe(env, "/prices", {
      currency: "jpy",
      unit_amount: amount,
      product: productId,
      recurring: { interval: "month" },
      tax_behavior: "exclusive",
      metadata: {
        service_slug: service.slug,
        service_id: String(service.id),
        customer_email,
        min_amount: String(minAmount),
      },
    });
    priceId = price.id;
  } catch (e) {
    return json({ ok: false, message: `Stripe price create failed: ${e.message}` }, 502);
  }

  // 7. Checkout Session 作成
  const siteUrl = (env.SITE_URL || "https://tusg.co.jp").replace(/\/$/, "");
  const sessionParams = {
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${siteUrl}/pay-forward/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/pay-forward/`,
    locale: "ja",
    client_reference_id: `svc_${service.id}_amt_${amount}`,
    subscription_data: {
      metadata: {
        service_slug: service.slug,
        service_id: String(service.id),
        quote_id: quoteRow?.id || "",
        min_amount_at_contract: String(minAmount),
        customer_email,
      },
    },
    metadata: {
      service_slug: service.slug,
      service_id: String(service.id),
      quote_id: quoteRow?.id || "",
      min_amount_at_contract: String(minAmount),
      customer_email,
    },
  };

  // Promotion code (100%割引テストクーポン等)
  if (promotion_code) {
    try {
      const promoLookup = await stripe(env, "/promotion_codes", {
        code: promotion_code,
        active: "true",
        limit: 1,
      }, "GET");
      const promo = promoLookup?.data?.[0];
      if (!promo) {
        return json({ ok: false, message: "Promotion code not found or inactive" }, 400);
      }
      sessionParams.discounts = [{ promotion_code: promo.id }];
    } catch (e) {
      return json({ ok: false, message: `Promotion code lookup failed: ${e.message}` }, 502);
    }
  } else {
    sessionParams.allow_promotion_codes = "true";
  }

  let session;
  try {
    session = await stripe(env, "/checkout/sessions", sessionParams);
  } catch (e) {
    return json({ ok: false, message: `Stripe checkout session create failed: ${e.message}` }, 502);
  }

  return json({
    ok: true,
    checkout_url: session.url,
    session_id: session.id,
  });
}
