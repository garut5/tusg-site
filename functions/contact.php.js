// POST /contact.php  -- 旧 contact.php の代替 (Cloudflare Pages Function)
//
// public/contact.html のフォーム項目に合わせて整形する。元の contact.php と
// 同じく Gmail などへメール送信 → /thanks.html へリダイレクト。
//
// 必須シークレット (wrangler pages secret put RESEND_API_KEY で登録):
//   RESEND_API_KEY     Resend (https://resend.com) の API キー
//
// 環境変数 (wrangler.toml [vars]):
//   CONTACT_TO_EMAIL   送信先 (例: info@tusg.site)
//   CONTACT_FROM_EMAIL Resend で検証済みドメインの送信元 (例: no-reply@mail.tusg.site)
//   CONTACT_FROM_NAME  送信元表示名
//   CONTACT_REDIRECT   送信成功時の遷移先 (デフォルト: /thanks.html)

// ---- 定数 (consultations.js と同じポリシー) ----
const ALLOWED_ORIGINS = new Set([
  "https://tusg.site",
  "https://www.tusg.site",
  "https://tusg.co.jp",
  "https://www.tusg.co.jp",
  "https://tusg-site.pages.dev",
]);
const MAX_BODY_BYTES = 32 * 1024; // 32KB
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;

const INQUIRY_LABELS = {
  saas: "SaaS開発・システム保守について",
  "it-support": "ITツール導入・運用支援について",
  sales: "営業支援・販売促進支援について",
  partner: "リード・アポイント提供パートナー制度について",
  compliance: "取引方針・コンプライアンスについて",
  other: "その他",
  marketing: "マーケティング支援について",
  consulting: "コンサルティングについて",
  hp: "ホームページ制作・運用について",
};

// ---- Helpers ----
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function sanitizeText(v, n) {
  if (typeof v !== "string") return "";
  return v
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, n);
}
function sanitizeSingleLine(v, n) {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\r\n\t]+/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, n)
    .trim();
}
function isValidEmail(v) {
  return typeof v === "string" && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}
function isValidPhone(v) {
  if (typeof v !== "string" || !v) return true;
  return /^[\d\-+() ]{7,20}$/.test(v);
}

// ---- Rate limit (isolate 単位、Cloudflare の Rate Limit ルールと併用推奨) ----
const rateLimitStore = new Map();
function checkRateLimit(id) {
  const now = Date.now();
  const arr = rateLimitStore.get(id) || [];
  const recent = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  rateLimitStore.set(id, recent);
  // GC
  if (rateLimitStore.size > 500) {
    for (const [k, v] of rateLimitStore) {
      const latest = v[v.length - 1];
      if (!latest || now - latest > RATE_LIMIT_WINDOW_MS) rateLimitStore.delete(k);
    }
  }
  return true;
}

// ---- バリデーション ----
function validate(fields) {
  const errors = [];
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  const email = typeof fields.email === "string" ? fields.email.trim() : "";
  const message = typeof fields.message === "string" ? fields.message : "";

  if (name.length < 1 || name.length > 60) errors.push("name is required (1-60 chars)");
  if (!isValidEmail(email)) errors.push("email is invalid");
  if (message.length < 1 || message.length > 2000) errors.push("message is required (1-2000 chars)");

  if (fields.companyName && (typeof fields.companyName !== "string" || fields.companyName.length > 100)) {
    errors.push("companyName too long");
  }
  if (fields.subject && (typeof fields.subject !== "string" || fields.subject.length > 150)) {
    errors.push("subject too long");
  }
  if (fields.phone && !isValidPhone(fields.phone)) {
    errors.push("phone is invalid");
  }
  if (fields.inquiryType && typeof fields.inquiryType !== "string") {
    errors.push("inquiryType is invalid");
  }
  return errors;
}

function buildMailBodies(fields) {
  const inquiryText = INQUIRY_LABELS[fields.inquiryType] || "未選択";

  const rows = [
    ["件名", sanitizeSingleLine(fields.subject || "", 150)],
    ["お問い合わせ種別", inquiryText],
    ["会社名", sanitizeSingleLine(fields.companyName || "", 100)],
    ["氏名", sanitizeSingleLine(fields.name || "", 60)],
    ["メール", sanitizeSingleLine(fields.email || "", 254)],
    ["電話番号", sanitizeSingleLine(fields.phone || "", 20)],
  ];
  const msg = sanitizeText(fields.message || "", 2000);

  const text =
    "【TUSG お問い合わせ内容】\n\n" +
    rows.map(([label, value]) => `${label}：${value}`).join("\n") +
    "\n\n【お問い合わせ内容】\n" + msg + "\n";

  const html =
    `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;">` +
    `<h2 style="margin:0 0 12px;">TUSG お問い合わせ内容</h2>` +
    `<table style="border-collapse:collapse;">` +
    rows
      .map(
        ([label, value]) =>
          `<tr><th style="text-align:left;padding:6px 16px 6px 0;color:#666;vertical-align:top;white-space:nowrap;">${escapeHtml(
            label
          )}</th><td style="padding:6px 0;">${escapeHtml(value)}</td></tr>`
      )
      .join("") +
    `</table>` +
    `<h3 style="margin:20px 0 8px;">お問い合わせ内容</h3>` +
    `<div style="white-space:pre-wrap;padding:12px;background:#f7f7f7;border-radius:4px;">${escapeHtml(
      msg
    )}</div>` +
    `</div>`;

  return { text, html, mailSubject: `【TUSG】${sanitizeSingleLine(fields.subject || "お問い合わせ", 150)}` };
}

async function sendViaResend(env, { fromName, fromEmail, toEmail, replyTo, subject, text, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [toEmail],
      reply_to: replyTo || undefined,
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY) {
    return new Response("Mail service is not configured.", { status: 500 });
  }
  const toEmail = env.CONTACT_TO_EMAIL;
  const fromEmail = env.CONTACT_FROM_EMAIL;
  const fromName = env.CONTACT_FROM_NAME || "TUSGコーポレートサイト";
  if (!toEmail || !fromEmail) {
    return new Response("Mail service is not configured.", { status: 500 });
  }

  // Origin check (best-effort — 同一オリジン POST では省略されることがある)
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  // Body size cap
  const cl = request.headers.get("content-length");
  if (cl && Number(cl) > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  // Rate limit per client IP
  const cip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!checkRateLimit(cip)) {
    return new Response("Too many requests", { status: 429 });
  }

  let fields = {};
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      fields = await request.json();
    } else {
      const formData = await request.formData();
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") fields[key] = value;
      }
    }
  } catch (err) {
    console.error("contact: parse error:", err.message);
    return new Response("Invalid request body", { status: 400 });
  }
  if (!fields || typeof fields !== "object") {
    return new Response("Invalid request body", { status: 400 });
  }

  // ハニーポット (任意のスパム対策フィールドが入っていれば表向きは成功)
  if (fields._gotcha || fields.honeypot) {
    return Response.redirect(new URL(env.CONTACT_REDIRECT || "/thanks.html", request.url), 303);
  }

  // サーバー側バリデーション
  const errors = validate(fields);
  if (errors.length) {
    // 一般ユーザーには詳細を返さない (本来は client で validate されているはず)
    console.error("contact: validation failed:", errors.join(", "));
    return new Response("入力内容に不備があります。再度ご確認ください。", { status: 422 });
  }

  const { text, html, mailSubject } = buildMailBodies(fields);
  const replyTo = isValidEmail(fields.email) ? fields.email : null;

  try {
    await sendViaResend(env, {
      fromName,
      fromEmail,
      toEmail,
      replyTo,
      subject: mailSubject,
      text,
      html,
    });
  } catch (err) {
    console.error("contact: send failed:", err.message);
    return new Response("送信に失敗しました。少し時間を置いてお試しください。", { status: 502 });
  }

  const redirectTo = env.CONTACT_REDIRECT || "/thanks.html";
  return Response.redirect(new URL(redirectTo, request.url), 303);
}

// GET: 旧 contact.php を直接開かれた場合に /contact.html へ誘導
export async function onRequestGet({ request }) {
  return Response.redirect(new URL("/contact.html", request.url), 302);
}

// その他のメソッド
export async function onRequest({ request }) {
  if (request.method === "POST" || request.method === "GET") return; // 上の handler が担当
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST, GET" } });
}
