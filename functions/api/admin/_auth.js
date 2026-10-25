// 管理画面 API 共通: Cloudflare Access 認証ヘルパー + 監査ログ記録 + 共通ユーティリティ
//
// 認証モデル:
//   /admin/* と /api/admin/* は Cloudflare Access で保護される。
//   Access 認証を通過したリクエストには以下のヘッダが自動で付与される:
//     Cf-Access-Authenticated-User-Email  — 管理者の email
//     Cf-Access-Jwt-Assertion              — Access が発行した JWT (再検証用)
//
//   本ハンドラでは、Access ヘッダの存在と、環境変数 ADMIN_ALLOWED_EMAILS に
//   記載された allowlist に含まれていることを確認する。
//   (Access 側ポリシーで既に絞られているが二重防御として)
//
// エラー時は 401/403 を JSON で返す。

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

export function dbRequired(env) {
  if (!env.TUSG_DB) {
    return json({
      ok: false,
      status: "db_not_bound",
      message: "D1 database (TUSG_DB) is not bound. Run: wrangler d1 create tusg-main, then update wrangler.toml and redeploy.",
    }, 503);
  }
  return null;
}

// 管理者 email を取得。ない / allowlist 外なら 401/403 を返す。
export function requireAdmin(request, env) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) {
    return {
      error: json({
        ok: false,
        status: "no_access_headers",
        message: "Cloudflare Access headers not present. Admin area must be protected by Access.",
      }, 401),
    };
  }
  const allowList = (env.ADMIN_ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // allowList が空なら「Access ポリシーに任せる (= 来た人を全員許可)」モード
  if (allowList.length > 0 && !allowList.includes(email.toLowerCase())) {
    return {
      error: json({ ok: false, status: "not_allowed", message: "This admin is not in ADMIN_ALLOWED_EMAILS." }, 403),
    };
  }
  return { email };
}

// 監査ログを追加 (fire-and-forget 用途でも await してエラーは返す)
export async function logAudit(env, request, {
  admin_email, action, target_type, target_id, payload,
}) {
  try {
    await env.TUSG_DB
      .prepare(
        `INSERT INTO admin_audit_logs
           (admin_email, action, target_type, target_id, payload, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        admin_email,
        action,
        target_type || null,
        target_id ? String(target_id) : null,
        payload ? JSON.stringify(payload) : null,
        request.headers.get("cf-connecting-ip") || null,
        (request.headers.get("user-agent") || "").slice(0, 500),
        Date.now()
      )
      .run();
  } catch (e) {
    console.error("logAudit failed:", e.message);
  }
}

// Body size 保護 + JSON parse
export async function readJson(request, maxBytes = 64 * 1024) {
  const cl = Number(request.headers.get("content-length") || 0);
  if (cl > maxBytes) {
    throw new Error("payload too large");
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("payload too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid JSON");
  }
}

// URL path の末尾セグメントから id を取得 (/api/admin/services/42 → 42)
export function pathId(request) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1];
}

// 文字列整形
export function trimStr(v, max) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}
