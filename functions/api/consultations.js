// POST /api/consultations
//
// お悩み・ご希望かんたん整理の最終送信を受け付ける Pages Function。
// - サーバー側バリデーション
// - 二重送信対策 (Idempotency-Key ヘッダの短期メモリキャッシュ、Cloudflare 単一 isolate 前提の best-effort)
// - Content-Type / Origin 検証
// - honeypot (payload._gotcha, payload.contact.nickname)
// - Resend で TUSG宛通知 + お客様宛受付メールを送信
//
// 環境変数:
//   RESEND_API_KEY               (secret)
//   RESEND_FROM_EMAIL            例: no-reply@mail.tusg.site
//   RESEND_FROM_NAME             例: TUSGコーポレートサイト
//   CONSULTATION_NOTIFICATION_TO 例: info@tusg.site
//   CONSULTATION_NOTIFICATION_CC 例: (空でも可)
//   SITE_URL                     例: https://tusg.site
//
// D1・Turnstile・管理画面は次PRで追加。MVP はメール通知のみ。

// ---- 定数 ----
const ALLOWED_ORIGINS = new Set([
  "https://tusg.site",
  "https://www.tusg.site",
  "https://tusg-site.pages.dev",
]);
const MAX_BODY_BYTES = 32 * 1024; // 32KB
const MIN_ELAPSED_MS = 3000;
const MAX_ELAPSED_MS = 6 * 60 * 60 * 1000; // 6h (窓を広め)

const PRIMARY_ISSUES = new Set([
  "reduce_paper_excel", "internal_efficiency", "build_saas",
  "customer_management", "document_management", "workforce",
  "multi_tenant", "reservation", "sns_map", "dashboard",
  "existing_maintenance", "security", "want_but_unorganized",
  "dont_know", "other",
]);

const PRIMARY_LABELS = {
  reduce_paper_excel: "紙・Excel・LINEでの管理を減らしたい",
  internal_efficiency: "社内業務を効率化・自動化したい",
  build_saas: "自社専用のWebシステムやSaaSを作りたい",
  customer_management: "顧客・案件・営業情報をまとめて管理したい",
  document_management: "契約書・見積書・請求書などを管理したい",
  workforce: "シフト・勤怠・スタッフ管理を改善したい",
  multi_tenant: "店舗・拠点・代理店ごとに情報を管理したい",
  reservation: "予約・問い合わせ対応を自動化したい",
  sns_map: "InstagramやGoogleマップなどを活用したい",
  dashboard: "データを集計して経営状況を見えるようにしたい",
  existing_maintenance: "既存システムを改善・保守してほしい",
  security: "セキュリティや情報管理を改善したい",
  want_but_unorganized: "作りたいものはあるが、整理できていない",
  dont_know: "何を導入すればよいか分からない",
  other: "その他",
};

// ---- 二重送信対策: idempotency-key の短期メモリキャッシュ (isolate 生存中のみ有効) ----
const idempotencyStore = new Map();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function rememberIdempotency(key, ref) {
  idempotencyStore.set(key, { at: Date.now(), reference: ref });
  // GC
  if (idempotencyStore.size > 200) {
    const now = Date.now();
    for (const [k, v] of idempotencyStore) {
      if (now - v.at > IDEMPOTENCY_TTL_MS) idempotencyStore.delete(k);
    }
  }
}
function lookupIdempotency(key) {
  const v = idempotencyStore.get(key);
  if (!v) return null;
  if (Date.now() - v.at > IDEMPOTENCY_TTL_MS) { idempotencyStore.delete(key); return null; }
  return v;
}

// ---- Helpers ----
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...headers,
    },
  });
}

function isValidEmail(v) {
  return typeof v === "string" && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}
function isValidPhone(v) {
  if (typeof v !== "string" || !v) return true;
  return /^[\d\-+() ]{7,20}$/.test(v);
}
function isValidUrl(v) {
  if (typeof v !== "string" || !v) return true;
  try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; }
  catch { return false; }
}
function truncate(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }
function sanitizeText(v, n) {
  if (typeof v !== "string") return "";
  return v
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, n);
}
function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---- 受付番号 ----
async function generateReference() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `TUSG-${y}${m}${d}-${hex}`;
}

// ---- Resend 送信 ----
async function sendMail(env, opts) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}

function buildInternalMail(payload, ref, env) {
  const primaryLabel = PRIMARY_LABELS[payload.primary_issue] || "未分類";
  const c = payload.contact || {};
  const industry = payload.common?.industry || "未回答";
  const timing = payload.common?.desired_timing || "未回答";
  const budget = payload.common?.budget || "未回答";
  const resultTitle = payload.result?.category_title || "参考情報 (未分類)";
  const method = { email: "メール", phone: "電話", any: "どちらでもよい" }[c.preferredContactMethod] || "未指定";

  // ⚠️ 通知メール本文は概要のみに絞る。詳細は認証済み管理画面で確認する方針。
  //    本MVPには管理画面がないため、担当者に必要な最低限の情報のみ含める。
  const text = [
    `TUSGコーポレートサイトに新しいご相談が届きました。`,
    ``,
    `受付番号: ${ref}`,
    `優先したい内容: ${primaryLabel}`,
    `整理結果: ${resultTitle}`,
    ``,
    `会社名: ${c.companyName || "-"}`,
    `担当者名: ${c.contactName || "-"}`,
    `メール: ${c.email || "-"}`,
    `電話: ${c.phone || "-"}`,
    `希望時期: ${timing}`,
    `希望連絡方法: ${method}`,
    `業種: ${industry}`,
    `予算感: ${budget}`,
    ``,
    `※詳細な自由記述はメール本文には含めていません。今後、認証付き管理画面で確認できるようにする予定です。`,
    `※このメールへの直接返信は避け、記載されたメールアドレス宛に返信してください。`,
  ].join("\n");

  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;">
<h2 style="margin:0 0 12px;">TUSGコーポレートサイト｜新しいご相談</h2>
<table style="border-collapse:collapse;">
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">受付番号</th><td style="padding:6px 0;font-family:monospace;font-weight:700;">${escapeHtml(ref)}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">優先したい内容</th><td style="padding:6px 0;">${escapeHtml(primaryLabel)}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">整理結果</th><td style="padding:6px 0;">${escapeHtml(resultTitle)}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">会社名</th><td style="padding:6px 0;">${escapeHtml(c.companyName || "-")}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">担当者名</th><td style="padding:6px 0;">${escapeHtml(c.contactName || "-")}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">メール</th><td style="padding:6px 0;"><a href="mailto:${escapeHtml(c.email || "")}">${escapeHtml(c.email || "-")}</a></td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">電話</th><td style="padding:6px 0;">${escapeHtml(c.phone || "-")}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">希望時期</th><td style="padding:6px 0;">${escapeHtml(timing)}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">希望連絡方法</th><td style="padding:6px 0;">${escapeHtml(method)}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">業種</th><td style="padding:6px 0;">${escapeHtml(industry)}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">予算感</th><td style="padding:6px 0;">${escapeHtml(budget)}</td></tr>
</table>
<p style="margin:16px 0 0;color:#7a5e08;font-size:12px;">※詳細な自由記述はメール本文には含めていません。認証付き管理画面で確認する運用に統一する予定です。</p>
</div>`;
  return { text, html };
}

function buildCustomerMail(payload, ref, env) {
  const c = payload.contact || {};
  const primaryLabel = PRIMARY_LABELS[payload.primary_issue] || "参考情報";
  const resultTitle = payload.result?.category_title || "参考情報 (未分類)";
  const siteUrl = env.SITE_URL || "https://tusg.site";

  const text = `${c.contactName || "ご担当者"} 様

このたびは、合同会社TUSGの「お悩み・ご希望かんたん整理」をご利用いただき、ありがとうございます。

以下の内容でご相談を受け付けました。

受付番号: ${ref}
優先したい内容: ${primaryLabel}
整理結果: ${resultTitle}

今回の整理結果は、回答内容をもとにした参考情報です。
正式なご提案、対応可否、費用、納期などは、現在の運用状況を確認したうえでご案内いたします。

入力内容を確認後、必要に応じて担当者よりご連絡いたします。

なお、このメールに心当たりがない場合は、下記窓口までご連絡ください。

合同会社TUSG
公式サイト: ${siteUrl}
お問い合わせ: info@tusg.site

このメールは自動送信されています。
`;

  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.75;color:#1a1f22;">
<p>${escapeHtml(c.contactName || "ご担当者")} 様</p>
<p>このたびは、合同会社TUSGの「お悩み・ご希望かんたん整理」をご利用いただき、ありがとうございます。</p>
<p>以下の内容でご相談を受け付けました。</p>
<table style="border-collapse:collapse;margin:12px 0;">
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">受付番号</th><td style="padding:6px 0;font-family:monospace;font-weight:700;">${escapeHtml(ref)}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">優先したい内容</th><td style="padding:6px 0;">${escapeHtml(primaryLabel)}</td></tr>
<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;">整理結果</th><td style="padding:6px 0;">${escapeHtml(resultTitle)}</td></tr>
</table>
<p>今回の整理結果は、回答内容をもとにした参考情報です。正式なご提案、対応可否、費用、納期などは、現在の運用状況を確認したうえでご案内いたします。</p>
<p>入力内容を確認後、必要に応じて担当者よりご連絡いたします。</p>
<p>なお、このメールに心当たりがない場合は、下記窓口までご連絡ください。</p>
<hr>
<p><strong>合同会社TUSG</strong><br>
公式サイト: <a href="${escapeHtml(siteUrl)}">${escapeHtml(siteUrl)}</a><br>
お問い合わせ: <a href="mailto:info@tusg.site">info@tusg.site</a></p>
<p style="font-size:12px;color:#666;">このメールは自動送信されています。</p>
</div>`;

  return { text, html };
}

// ---- サーバー側バリデーション ----
function validate(payload) {
  const errors = [];

  if (!PRIMARY_ISSUES.has(payload.primary_issue)) {
    errors.push("primary_issue is invalid");
  }

  const c = payload.contact || {};
  if (typeof c.companyName !== "string" || c.companyName.trim().length < 1 || c.companyName.length > 100) {
    errors.push("companyName is required (1-100 chars)");
  }
  if (typeof c.contactName !== "string" || c.contactName.trim().length < 1 || c.contactName.length > 60) {
    errors.push("contactName is required (1-60 chars)");
  }
  if (!isValidEmail(c.email)) errors.push("email is invalid");
  if (c.phone && !isValidPhone(c.phone)) errors.push("phone is invalid");
  if (c.websiteUrl && !isValidUrl(c.websiteUrl)) errors.push("websiteUrl is invalid");
  if (c.prefecture && (typeof c.prefecture !== "string" || c.prefecture.length > 20)) {
    errors.push("prefecture is too long");
  }
  if (c.preferredContactMethod && !["email", "phone", "any"].includes(c.preferredContactMethod)) {
    errors.push("preferredContactMethod is invalid");
  }
  if (c.preferredContactTime && (typeof c.preferredContactTime !== "string" || c.preferredContactTime.length > 60)) {
    errors.push("preferredContactTime is too long");
  }

  if (!payload.consent || payload.consent.privacy !== true) {
    errors.push("privacy consent is required");
  }

  // 最低入力時間
  const elapsed = Number(payload.elapsed_ms);
  if (!Number.isFinite(elapsed) || elapsed < MIN_ELAPSED_MS || elapsed > MAX_ELAPSED_MS) {
    errors.push("elapsed_ms out of range");
  }

  if (typeof payload.free_text === "string" && payload.free_text.length > 2000) {
    errors.push("free_text too long");
  }

  return errors;
}

// ---- Rate limit (isolate 単位の軽い制限。CFのRate Limitルールと併用推奨) ----
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
function checkRateLimit(id) {
  const now = Date.now();
  const arr = rateLimitStore.get(id) || [];
  const recent = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  rateLimitStore.set(id, recent);
  return true;
}

// ---- Main handler ----
export async function onRequestPost({ request, env }) {
  try {
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      return json({ ok: false, message: "Mail service is not configured." }, 500);
    }
    const to = env.CONSULTATION_NOTIFICATION_TO || env.CONTACT_TO_EMAIL || "info@tusg.site";
    const cc = env.CONSULTATION_NOTIFICATION_CC ? [env.CONSULTATION_NOTIFICATION_CC] : undefined;

    // Content-Type
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return json({ ok: false, message: "Content-Type must be application/json" }, 415);
    }
    // Origin (best-effort — 同一オリジンからの実POSTでは省略される場合あり)
    const origin = request.headers.get("origin");
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ ok: false, message: "Origin not allowed" }, 403);
    }

    // Body size
    const cl = request.headers.get("content-length");
    if (cl && Number(cl) > MAX_BODY_BYTES) {
      return json({ ok: false, message: "Payload too large" }, 413);
    }

    // Rate limit (client IP)
    const cip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!checkRateLimit(cip)) {
      return json({ ok: false, message: "Too many requests" }, 429);
    }

    // Idempotency
    const idemKey = request.headers.get("idempotency-key") || "";
    if (idemKey) {
      const prev = lookupIdempotency(idemKey);
      if (prev) return json({ ok: true, reference: prev.reference, cached: true });
    }

    // Body
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, message: "Invalid JSON" }, 400); }
    if (!payload || typeof payload !== "object") {
      return json({ ok: false, message: "Invalid payload" }, 400);
    }

    // Honeypot (通常フォーム互換 + ウィザード用フィールド名)
    if (payload._gotcha || payload.honeypot || payload?.contact?.nickname) {
      // 表向きは成功
      const ref = await generateReference();
      return json({ ok: true, reference: ref });
    }

    // Validate
    const errors = validate(payload);
    if (errors.length) {
      return json({ ok: false, message: "Validation failed", errors }, 422);
    }

    // Sanitize free-text
    if (typeof payload.free_text === "string") {
      payload.free_text = sanitizeText(payload.free_text, 2000);
    }

    // Reference & mails
    const ref = await generateReference();

    const fromEmail = env.RESEND_FROM_EMAIL;
    const fromName = env.RESEND_FROM_NAME || "TUSGコーポレートサイト";
    const from = `${fromName} <${fromEmail}>`;

    const internal = buildInternalMail(payload, ref, env);
    const customer = buildCustomerMail(payload, ref, env);

    // 内部通知は必須。失敗した場合はエラーを返す。
    try {
      await sendMail(env, {
        from,
        to: [to],
        cc,
        reply_to: payload.contact?.email && isValidEmail(payload.contact.email) ? payload.contact.email : undefined,
        subject: `【TUSG公式サイト】新しいご相談が届きました｜受付番号：${ref}`,
        text: internal.text,
        html: internal.html,
      });
    } catch (e) {
      console.error("internal mail failed:", e.message);
      return json({ ok: false, message: "送信に失敗しました。少し時間を置いてお試しください。" }, 502);
    }

    // 顧客宛受付メールは best-effort (失敗しても相談自体は成立させる)
    try {
      await sendMail(env, {
        from,
        to: [payload.contact.email],
        subject: `【合同会社TUSG】ご相談を受け付けました｜${ref}`,
        text: customer.text,
        html: customer.html,
      });
    } catch (e) {
      console.error("customer mail failed:", e.message);
    }

    if (idemKey) rememberIdempotency(idemKey, ref);
    return json({ ok: true, reference: ref });
  } catch (err) {
    console.error("consultations error:", err.message);
    return json({ ok: false, message: "サーバー内部エラー" }, 500);
  }
}

// GET は 405
export async function onRequestGet() {
  return json({ ok: false, message: "Method not allowed" }, 405, { Allow: "POST" });
}
