// POST /api/pay-forward/inquiry
//
// 顧客が /pay-forward/request-quote から見積依頼を送信するエンドポイント。
// pay_forward_inquiries テーブルに INSERT し、admin に Resend で通知する。
//
// 中間フォーム (contact.html 経由) を介さないので、admin は
// 「どのサービスの、どんな要件の、誰からの見積依頼か」を
// 構造化データとして受け取れる。
//
// Basic 認証対象外 (公開 POST として middleware で bypass)

import { json, unavailable, isPayForwardEnabled, checkOrigin, fetchService } from "./_shared.js";

const BUDGET_FEELS = new Set(["unknown", "under_5000", "5000_15000", "15000_30000", "over_30000"]);

function trim(v, max = 2000) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}
function isValidEmail(email) {
  if (typeof email !== "string") return false;
  if (email.length > 254) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}
function uuid() { return crypto.randomUUID(); }

export async function onRequestPost({ request, env }) {
  if (!isPayForwardEnabled(env)) return unavailable();
  if (!checkOrigin(request)) return json({ ok: false, message: "Origin not allowed" }, 403);

  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, message: "Invalid JSON" }, 400); }

  // Honeypot (hidden _gotcha)
  if (trim(payload._gotcha, 100)) return json({ ok: true, status: "ignored" }, 200);

  const service_slug = trim(payload.service_slug, 80);
  const customer_name = trim(payload.customer_name, 100);
  const customer_email = trim(payload.customer_email, 254);
  const customer_company = trim(payload.customer_company, 100);
  const customer_phone = trim(payload.customer_phone, 50);
  const desired_pages = Number.isInteger(Number(payload.desired_pages)) && Number(payload.desired_pages) > 0
    ? Math.min(Number(payload.desired_pages), 999) : null;
  const desired_deadline = trim(payload.desired_deadline, 100);
  const budget_feel_raw = trim(payload.budget_feel, 32);
  const budget_feel = BUDGET_FEELS.has(budget_feel_raw) ? budget_feel_raw : "unknown";
  const requirements = trim(payload.requirements, 5000);
  const source = trim(payload.source, 50) || "lp";

  if (!customer_name) return json({ ok: false, message: "お名前が必要です" }, 400);
  if (!isValidEmail(customer_email)) return json({ ok: false, message: "有効なメールアドレスが必要です" }, 400);
  if (!requirements) return json({ ok: false, message: "要件・ご相談内容が必要です" }, 400);

  // サービス存在チェック (任意 — サービス指定なしでも受け付ける)
  let service = null;
  let service_id = null;
  if (service_slug) {
    service = await fetchService(env.TUSG_DB, service_slug);
    if (service) service_id = service.id;
  }

  const id = uuid();
  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") || null;
  const ua = (request.headers.get("User-Agent") || "").slice(0, 500);

  await env.TUSG_DB
    .prepare(
      `INSERT INTO pay_forward_inquiries
        (id, service_id, service_slug_at_submit, customer_name, customer_email,
         customer_company, customer_phone, desired_pages, desired_deadline,
         budget_feel, requirements, source, status, ip, user_agent,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`
    )
    .bind(
      id, service_id, service_slug || null, customer_name, customer_email,
      customer_company || null, customer_phone || null, desired_pages, desired_deadline || null,
      budget_feel, requirements, source, ip, ua, now, now
    )
    .run();

  // Resend で admin 通知 (失敗してもユーザー体験は維持)
  try {
    await notifyAdmin(env, {
      id,
      service_name: service?.name || service_slug || "(サービス指定なし)",
      service_slug,
      customer_name, customer_email, customer_company, customer_phone,
      desired_pages, desired_deadline, budget_feel, requirements,
    });
  } catch (e) {
    console.error("[pay-forward inquiry] admin notify failed:", e?.message || e);
  }

  return json({
    ok: true,
    id,
    message: "見積依頼を受け付けました。担当者が内容を確認し、2 営業日以内に見積リンクをお送りします。",
  });
}

async function notifyAdmin(env, data) {
  const apiKey = env.RESEND_API_KEY;
  const to = env.ADMIN_ALERT_EMAIL || env.CONSULTATION_NOTIFICATION_TO || env.CONTACT_TO_EMAIL;
  if (!apiKey || !to) return;
  const from = env.RESEND_FROM_NAME
    ? `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`
    : env.RESEND_FROM_EMAIL;

  const BUDGET_LABEL = {
    unknown: "指定なし",
    under_5000: "5,000 円未満",
    "5000_15000": "5,000 〜 15,000 円",
    "15000_30000": "15,000 〜 30,000 円",
    over_30000: "30,000 円以上",
  };
  const siteUrl = (env.SITE_URL || "https://tusg.co.jp").replace(/\/$/, "");

  const bodyText = [
    "Pay Forward 見積依頼が届きました。",
    "",
    `対象サービス: ${data.service_name}${data.service_slug ? " (" + data.service_slug + ")" : ""}`,
    `お名前: ${data.customer_name}`,
    `メール: ${data.customer_email}`,
    data.customer_company ? `会社名: ${data.customer_company}` : null,
    data.customer_phone ? `電話: ${data.customer_phone}` : null,
    data.desired_pages ? `希望ページ数: ${data.desired_pages}` : null,
    data.desired_deadline ? `希望納期: ${data.desired_deadline}` : null,
    `予算感: ${BUDGET_LABEL[data.budget_feel] || data.budget_feel}`,
    "",
    "要件・ご相談内容:",
    data.requirements,
    "",
    "────────────────",
    `管理画面で見積発行: ${siteUrl}/admin/#inquiries`,
    `依頼 ID: ${data.id}`,
  ].filter((l) => l != null).join("\n");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `【Pay Forward 見積依頼】${data.service_name}｜${data.customer_name}`,
      text: bodyText,
      reply_to: data.customer_email,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Resend ${resp.status}: ${err.slice(0, 300)}`);
  }
}
