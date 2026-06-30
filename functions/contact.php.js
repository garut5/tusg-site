// POST /contact.php  -- 旧 contact.php の代替 (Cloudflare Pages Function)
//
// public/contact.html のフォーム項目に合わせて整形する。元の contact.php と
// 同じく Gmail などへメール送信 → /thanks.html へリダイレクト。
//
// 必須シークレット (wrangler pages secret put RESEND_API_KEY で登録):
//   RESEND_API_KEY     Resend (https://resend.com) の API キー
//
// 環境変数 (wrangler.toml [vars]):
//   CONTACT_TO_EMAIL   送信先 (例: goandgoing53@gmail.com)
//   CONTACT_FROM_EMAIL Resend で検証済みドメインの送信元 (例: no-reply@tusg.site)
//   CONTACT_FROM_NAME  送信元表示名
//   CONTACT_REDIRECT   送信成功時の遷移先 (デフォルト: /thanks.html)

const INQUIRY_LABELS = {
  saas: "SaaS開発・システム保守について",
  "it-support": "ITツール導入・運用支援について",
  sales: "営業支援・販売促進支援について",
  partner: "リード・アポイント提供パートナー制度について",
  compliance: "取引方針・コンプライアンスについて",
  other: "その他",
  // 旧フォームからの送信にも対応
  marketing: "マーケティング支援について",
  consulting: "コンサルティングについて",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMailBodies(fields) {
  const inquiryText = INQUIRY_LABELS[fields.inquiryType] || "未選択";

  const rows = [
    ["件名", fields.subject || ""],
    ["お問い合わせ種別", inquiryText],
    ["会社名", fields.companyName || ""],
    ["氏名", fields.name || ""],
    ["メール", fields.email || ""],
    ["電話番号", fields.phone || ""],
  ];

  const text =
    "【TUSG お問い合わせ内容】\n\n" +
    rows.map(([label, value]) => `${label}：${value}`).join("\n") +
    "\n\n【お問い合わせ内容】\n" +
    (fields.message || "") +
    "\n";

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
      fields.message || ""
    )}</div>` +
    `</div>`;

  return { text, html, mailSubject: `【TUSG】${fields.subject || "お問い合わせ"}` };
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

  const toEmail = env.CONTACT_TO_EMAIL;
  const fromEmail = env.CONTACT_FROM_EMAIL;
  const fromName = env.CONTACT_FROM_NAME || "TUSGコーポレートサイト";
  if (!toEmail || !fromEmail) {
    return new Response(
      "CONTACT_TO_EMAIL / CONTACT_FROM_EMAIL is not configured in wrangler.toml [vars].",
      { status: 500 }
    );
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
    return new Response(`Failed to parse request body: ${err.message}`, { status: 400 });
  }

  // ハニーポット (任意のスパム対策フィールドが入っていれば黙殺)
  if (fields._gotcha || fields.honeypot) {
    return Response.redirect(new URL(env.CONTACT_REDIRECT || "/thanks.html", request.url), 303);
  }

  const { text, html, mailSubject } = buildMailBodies(fields);
  const replyTo =
    fields.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email) ? fields.email : null;

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
    console.error(err);
    return new Response(`Failed to send email: ${err.message}`, { status: 502 });
  }

  const redirectTo = env.CONTACT_REDIRECT || "/thanks.html";
  return Response.redirect(new URL(redirectTo, request.url), 303);
}

export async function onRequestGet() {
  return Response.redirect("/contact.html", 302);
}
