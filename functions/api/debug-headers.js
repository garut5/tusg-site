// GET /api/debug-headers
//
// 診断用: Cloudflare Access のヘッダ注入状況を確認する一時エンドポイント。
// 認証なしで誰でもアクセス可能なので、調査完了後に削除すること。

export async function onRequestGet({ request }) {
  const headers = {};
  for (const [k, v] of request.headers) {
    headers[k] = v.length > 200 ? v.slice(0, 200) + "..." : v;
  }
  const url = new URL(request.url);
  return new Response(JSON.stringify({
    hostname: url.hostname,
    path: url.pathname,
    method: request.method,
    headers,
    diagnostic_note: "This endpoint shows all headers Cloudflare delivered to the Pages Function. If Access is enforcing, you should see Cf-Access-Jwt-Assertion and Cf-Access-Authenticated-User-Email headers.",
  }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
