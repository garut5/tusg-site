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

// Cloudflare Access JWT の完全検証
// 参考: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
//
// 検証項目:
//   1. 署名 (JWKS で RSASSA-PKCS1-v1_5 / RS256)
//   2. aud が本 Access app の AUD と一致
//   3. iss が team domain と一致
//   4. exp (有効期限) が未来
//   5. nbf (not before) が過去
//
// 1 時間 isolate 内キャッシュ

const ACCESS_TEAM_DOMAIN = "https://tusgreach.cloudflareaccess.com";
const ACCESS_APP_AUD     = "8235c40c3592d77e0a0d0752dc4b182c0adee51443653f36aca10db18019aba4";
const JWKS_TTL_MS        = 60 * 60 * 1000;

let _jwksCache = null;
let _jwksAt = 0;

async function fetchJwks() {
  const now = Date.now();
  if (_jwksCache && (now - _jwksAt) < JWKS_TTL_MS) return _jwksCache;
  const res = await fetch(`${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  _jwksCache = await res.json();
  _jwksAt = now;
  return _jwksCache;
}

function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64urlToJson(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return JSON.parse(bin);
}

// JWT を検証し payload を返す。失敗時は null。
async function verifyAccessJwt(jwt) {
  if (!jwt || typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = b64urlToJson(headerB64);
    payload = b64urlToJson(payloadB64);
  } catch { return null; }

  // 時刻検証
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;

  // aud / iss
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(ACCESS_APP_AUD)) return null;
  if (payload.iss && payload.iss !== ACCESS_TEAM_DOMAIN) return null;

  // 署名検証
  let jwks;
  try { jwks = await fetchJwks(); } catch { return null; }
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  let publicKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } },
      false,
      ["verify"]
    );
  } catch { return null; }

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = b64urlToBytes(sigB64);
  const ok = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    signature,
    data
  );
  if (!ok) return null;

  return payload;
}

const ADMIN_ALLOWED_HOSTS = new Set([
  "tusg.co.jp",
  "www.tusg.co.jp",
]);

// 管理者認証 (async)。Pages Function 側で await してからエラー分岐してください。
export async function requireAdmin(request, env) {
  const url = new URL(request.url);
  if (!ADMIN_ALLOWED_HOSTS.has(url.hostname)) {
    return {
      error: json({
        ok: false,
        status: "wrong_host",
        message: `Admin API is only accessible via https://tusg.co.jp/ (seen: ${url.hostname}).`,
      }, 403),
    };
  }

  // JWT 検証 (Cloudflare Access edge は既に検証済みだが、二重防御)
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  const payload = await verifyAccessJwt(jwt);
  if (!payload) {
    // 診断情報: 届いているヘッダのサマリ (値は切り詰め)
    const cfHeaders = {};
    for (const [k, v] of request.headers) {
      if (k.toLowerCase().startsWith("cf-access-") || k.toLowerCase() === "cf-ray") {
        cfHeaders[k] = v.length > 80 ? v.slice(0, 80) + `...(${v.length}b)` : v;
      }
    }
    return {
      error: json({
        ok: false,
        status: "no_access_identity",
        message: "Cloudflare Access JWT missing or invalid. Please re-login via https://tusg.co.jp/admin/",
        received: cfHeaders,
      }, 401),
    };
  }

  const email = payload.email || payload.custom?.email;
  if (!email) {
    return {
      error: json({ ok: false, status: "no_email_in_jwt", message: "JWT has no email claim" }, 401),
    };
  }

  const allowList = (env.ADMIN_ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowList.length > 0 && !allowList.includes(email.toLowerCase())) {
    return {
      error: json({
        ok: false,
        status: "not_allowed",
        message: `Admin "${email}" is not in ADMIN_ALLOWED_EMAILS.`,
      }, 403),
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
