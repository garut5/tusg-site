// GET /api/admin/me
//
// 現在ログインしている管理者情報と、D1/Stripe 等のバインディング状況を返す。
// 管理画面の起動時に呼ばれ、UI は結果に応じて表示を分岐する。

import { json, requireAdmin } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env);
  if (auth.error) return auth.error;

  return json({
    ok: true,
    admin: { email: auth.email },
    status: {
      d1_bound: Boolean(env.TUSG_DB),
      stripe_secret_set: Boolean(env.TUSG_STRIPE_SECRET_KEY),
      stripe_webhook_set: Boolean(env.TUSG_STRIPE_WEBHOOK_SECRET),
      pay_forward_enabled: String(env.PAY_FORWARD_ENABLED || "false").toLowerCase() === "true",
      resend_api_key_set: Boolean(env.RESEND_API_KEY),
    },
    server_time: new Date().toISOString(),
  });
}
