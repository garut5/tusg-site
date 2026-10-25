// 旧 /contact.php への互換ハンドラ (本体は functions/api/contact.js に移動済み)
//
// 旧サイトが PHP で動いていた時代の /contact.php への古いブックマークや
// 外部リンクを壊さないよう、現行の /api/contact へ 308 永続リダイレクトする。
// 308 を使うのは POST の method / body を保持したまま転送するため
// (301/302 だと一部クライアントが GET に変換してしまう)。

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const newUrl = new URL("/api/contact", url);
  newUrl.search = url.search;
  return Response.redirect(newUrl.toString(), 308);
}
