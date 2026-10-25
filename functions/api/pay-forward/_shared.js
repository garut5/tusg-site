// Pay Forward 共通ヘルパー
// すべての Pay Forward エンドポイントで使う JSON レスポンス、認可、
// サービス有効化フラグチェック、D1 バインディング確認等を一元化。

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...extraHeaders,
    },
  });
}

export function unavailable(message = "Pay Forward is not yet available") {
  return json({ ok: false, status: "unavailable", message }, 503);
}

// 機能有効化チェック
// PAY_FORWARD_ENABLED=true かつ TUSG_DB (D1) binding + TUSG_STRIPE_SECRET_KEY が揃った時のみ有効
export function isPayForwardEnabled(env) {
  const flag = String(env.PAY_FORWARD_ENABLED || "false").toLowerCase() === "true";
  const hasDb = Boolean(env.TUSG_DB);
  const hasStripe = Boolean(env.TUSG_STRIPE_SECRET_KEY);
  return flag && hasDb && hasStripe;
}

// 長さに依存しない定数時間比較 (管理者トークン等の照合用)
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const la = a.length;
  const lb = b.length;
  const maxLen = Math.max(la, lb, 1);
  let diff = la ^ lb;
  for (let i = 0; i < maxLen; i++) {
    const ca = i < la ? a.charCodeAt(i) : 0;
    const cb = i < lb ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

// 入力金額バリデーション (JPY 税抜、整数、最低額以上)
export function validateAmount(input, minAmount) {
  const amount = Number(input);
  if (!Number.isInteger(amount)) {
    return { ok: false, message: "amount must be an integer" };
  }
  if (amount < 100) {
    return { ok: false, message: "amount must be at least 100 JPY" };
  }
  if (amount > 10_000_000) {
    return { ok: false, message: "amount exceeds maximum" };
  }
  if (minAmount != null && amount < minAmount) {
    return { ok: false, message: `amount must be at least ${minAmount} JPY (minimum for this service)` };
  }
  return { ok: true, amount };
}

// 顧客からの Pay Forward エンドポイントへのアクセス元チェック
const ALLOWED_ORIGINS = new Set([
  "https://tusg.co.jp",
  "https://www.tusg.co.jp",
  "https://tusg.site",
  "https://www.tusg.site",
  "https://tusg-site.pages.dev",
]);

export function checkOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // 同一オリジン POST では省略されることがある
  return ALLOWED_ORIGINS.has(origin);
}

// サービスを slug で取得
export async function fetchService(db, slug) {
  const r = await db
    .prepare("SELECT * FROM services WHERE slug = ? AND is_published = 1 LIMIT 1")
    .bind(slug)
    .first();
  return r || null;
}

// 現時点の最低料金を取得 (effective_from <= now AND (effective_to IS NULL OR effective_to > now))
export async function fetchCurrentPricingRule(db, serviceId) {
  const now = Date.now();
  const r = await db
    .prepare(
      `SELECT * FROM pricing_rules
       WHERE service_id = ?
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY effective_from DESC
       LIMIT 1`
    )
    .bind(serviceId, now, now)
    .first();
  return r || null;
}
