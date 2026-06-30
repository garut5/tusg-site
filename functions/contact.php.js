// POST /contact.php  -- contact.php の代替 Cloudflare Pages Function
//
// 必須シークレット (wrangler pages secret put RESEND_API_KEY などで設定):
//   RESEND_API_KEY   Resend (https://resend.com) の API キー
//
// 任意の環境変数 (wrangler.toml の [vars] で設定):
//   CONTACT_TO_EMAIL    送信先メールアドレス     (例: info@tusg.jp)
//   CONTACT_FROM_EMAIL  送信元メールアドレス     (例: noreply@tusg.jp / Resendで検証済みドメイン)
//   CONTACT_FROM_NAME   送信元表示名             (例: TUSGコーポレートサイト)
//   CONTACT_REDIRECT    送信成功後のリダイレクト先 (デフォルト: /thanks.html)

const FIELD_LABELS = {
  name: "お名前",
  company: "会社名",
  email: "メールアドレス",
  tel: "電話番号",
  phone: "電話番号",
  subject: "件名",
  message: "お問い合わせ内容",
  body: "お問い合わせ内容",
  inquiry: "お問い合わせ内容",
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMailBodies(fields) {
  const entries = Object.entries(fields).filter(
    ([key]) => !key.startsWith("_") && key !== "g-recaptcha-response"
  );

  const text = entries
    .map(([key, value]) => `■ ${FIELD_LABELS[key] ?? key}\n${value}\n`)
    .join("\n");

  const html =
    `<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">` +
    entries
      .map(
        ([key, value]) =>
          `<tr><th style="text-align:left;padding:8px 16px 8px 0;vertical-align:top;color:#666;">${escapeHtml(
            FIELD_LABELS[key] ?? key
          )}</th><td style="padding:8px 0;white-space:pre-wrap;">${escapeHtml(value)}</td></tr>`
      )
      .join("") +
    `</table>`;

  return { text, html };
}

async function sendViaResend(env, { fromEmail, fromName, toEmail, replyTo, subject, text, html }) {
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
    const detail = await res.text();
    throw new Error(`Resend API error (${res.status}): ${detail}`);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY) {
    return new Response(
      "Mail service is not configured. Set RESEND_API_KEY via `wrangler pages secret put RESEND_API_KEY`.",
      { status: 500 }
    );
  }

  const contentType = request.headers.get("content-type") || "";
  let fields = {};

  try {
    if (contentType.includes("application/json")) {
      fields = await request.json();
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await request.formData();
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") {
          fields[key] = value;
        }
      }
    } else {
      return new Response("Unsupported content-type", { status: 415 });
    }
  } catch (err) {
    return new Response(`Failed to parse request body: ${err.message}`, { status: 400 });
  }

  // ハニーポット (任意): _gotcha などの hidden 入力に値があれば spam として黙殺
  if (fields._gotcha || fields.honeypot) {
    return Response.redirect(new URL(env.CONTACT_REDIRECT || "/thanks.html", request.url), 303);
  }

  const toEmail = env.CONTACT_TO_EMAIL;
  const fromEmail = env.CONTACT_FROM_EMAIL;
  const fromName = env.CONTACT_FROM_NAME || "TUSG website";
  if (!toEmail || !fromEmail) {
    return new Response(
      "CONTACT_TO_EMAIL / CONTACT_FROM_EMAIL is not configured in wrangler.toml [vars].",
      { status: 500 }
    );
  }

  const { text, html } = buildMailBodies(fields);
  const subject = `[お問い合わせ] ${fields.subject || fields.name || "新規お問い合わせ"}`;
  const replyTo = fields.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email) ? fields.email : null;

  try {
    await sendViaResend(env, { fromEmail, fromName, toEmail, replyTo, subject, text, html });
  } catch (err) {
    console.error(err);
    return new Response(`Failed to send email: ${err.message}`, { status: 502 });
  }

  const redirectTo = env.CONTACT_REDIRECT || "/thanks.html";
  return Response.redirect(new URL(redirectTo, request.url), 303);
}

export async function onRequestGet() {
  // 旧 contact.php への GET は問い合わせフォームに戻す
  return Response.redirect("/contact.html", 302);
}
