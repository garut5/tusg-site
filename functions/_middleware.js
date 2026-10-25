// Pages 全体ミドルウェア
//
// 目的 (当面): Pay Forward 系ページ・API に HTTP Basic 認証を掛けて、
//            Stripe 本番決済を検証中の間、一般公開を遮断する。
//
// 対象パス:
//   /pay-forward                 (LP)
//   /pay-forward.html            (正規化前の URL)
//   /pay-forward/*               (将来追加される申込・ポータル画面)
//   /api/pay-forward/*           (checkout / webhook / services)
//
// ただし Stripe からの webhook POST は認証無しで通す
// (/api/pay-forward/webhook の署名検証で保護されている)。
//
// パスワード運用:
//   env.PAY_FORWARD_BASIC_AUTH_PASSWORD = "1234" のとき Basic 認証を要求
//   未設定または空文字 の時は認証スキップ (= 公開モード)

const PROTECTED_PREFIX_RE = /^\/(pay-forward(\.html)?(\/|$)|api\/pay-forward\/)/;
const WEBHOOK_PATH = "/api/pay-forward/webhook";
// サービスカタログ (公開中サービスの読み取り) は認証対象外にする。
// 理由: Chrome の fetch API は Basic 認証の cached credentials を自動送信
//      しないケースがあり、apply.html の services 読込が 401 で詰まる。
//      内容は「公開中のサービス一覧 + 最低料金」のみで、申込 (checkout)
//      エンドポイントは引き続き Basic 認証で保護されるため実害なし。
const PUBLIC_GET_PATHS = new Set(["/api/pay-forward/services"]);

export const onRequest = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // 保護対象外はスルー
  if (!PROTECTED_PREFIX_RE.test(url.pathname)) {
    return next();
  }

  // Stripe webhook は Basic 認証対象外 (署名検証で保護)
  if (url.pathname === WEBHOOK_PATH && request.method === "POST") {
    return next();
  }

  // 公開カタログ GET は Basic 認証対象外 (Chrome の fetch 認証伝播問題回避)
  if (request.method === "GET" && PUBLIC_GET_PATHS.has(url.pathname)) {
    return next();
  }

  // パスワード未設定 = 公開モード (本番公開時にこの変数を unset する)
  const password = env.PAY_FORWARD_BASIC_AUTH_PASSWORD;
  if (!password) {
    return next();
  }

  // Authorization: Basic <base64(user:pass)> を検証
  const header = request.headers.get("Authorization") || "";
  const m = header.match(/^Basic\s+([A-Za-z0-9+/=]+)$/);
  if (m) {
    try {
      const decoded = atob(m[1]);
      const idx = decoded.indexOf(":");
      const pass = idx >= 0 ? decoded.slice(idx + 1) : "";
      if (constantTimeEqual(pass, String(password))) {
        return next();
      }
    } catch {
      // fallthrough to 401
    }
  }

  return new Response("Authentication required (Pay Forward testing)", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Pay Forward (Testing)", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

function constantTimeEqual(a, b) {
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
