# tusg.site → tusg.co.jp 切り替えの調査（2026-10-20・調査のみ、何も変えていない）

> tusg.site を使っているサイトで tusg.co.jp にすべて切り替えたい。
> Google console や Meta の切り替えも必要だと考えている。

この時点では**コード・DNS・外部サービスのどれも変更していない。**
読んだのはセッションに付いていた 15 リポジトリと、公開 DNS（dns.google）と各トップページ。
一次データは `dns-raw-20261020.txt`、取ったスクリプトは `dns-check.sh`。

---

## 0. いまの状態（実測）

| 項目 | tusg.site | tusg.co.jp |
|---|---|---|
| ネームサーバー | Cloudflare `aliza` / `chuck` | Cloudflare `paul` / `riya` |
| トップ | 200（コーポレートサイト） | **200（同じサイトがそのまま出ている）** |
| canonical | `https://tusg.site/` | **`https://tusg.site/`**（新ドメインなのに旧を指す） |
| MX | **無し** | Cloudflare Email Routing（route1-3） |
| SPF | 無し | `include:_spf.mx.cloudflare.net` |
| DMARC | `p=none` | 無し |
| Search Console 認証 | `google-site-verification=…`（DNS・ドメインプロパティ） | 無し |
| Resend 送信ドメイン | `mail.tusg.site`（DKIM・`send.` MX あり） | 無し |

読み取れること:

1. **NS の組が違う → 2つのゾーンは別の Cloudflare アカウントにある可能性が高い**（推定。
   Cloudflare は NS の組をアカウントごとに割り当てる）。fanmap の記録では tusg.site は
   **Goandgoing53 のアカウント**（`fanmap/docs/OFF_VERCEL_2026-08.md:197`）。
   **Workers の Custom Domain はゾーンが同じアカウントに無いと付けられない**
   → fanmap / foodtap（Workers）を tusg.co.jp に載せるなら、tusg.co.jp のゾーンが
   Goandgoing53 側に要る。どちらのアカウントにあるかをまずダッシュボードで確認する。
2. **tusg.co.jp はすでに同じサイトを返している**が、canonical が tusg.site なので
   Google は tusg.site を正として扱う。今は重複扱いで実害は小さいが、切り替えでは逆にする。
3. 🔴 **tusg.site に MX が無い。** `info@tusg.site`・`help@fanmap.tusg.site`・
   `meta-review@tusg.site` は**いま受信できていない可能性が高い**（README.md:38 は
   「Email Routing で受信」と書いているが、DNS に MX が無い）。これらは
   Meta アプリの連絡先・法務ページ・問い合わせ通知先に載っている。
   **切り替えとは別に、先に確認したほうがよい。**
4. Resend で認証済みなのは `mail.tusg.site` だけ。fanmap / foodtap / lococreate の
   既定の From（`no-reply@fanmap.tusg.site`・`fanmap-crm.tusg.site`・`foodtap.tusg.site`・
   `lococreate.tusg.site`）は DKIM が無い。本番の secret で上書きしていなければ届いていない
   （secret の中身はリポジトリから見えないので未確認）。

---

## 1. tusg.site を使っているもの（本番で生きているもの）

| ホスト | リポジトリ | 載っている所 | 重さ |
|---|---|---|---|
| `tusg.site` / `www.` | tusg-site | Cloudflare Pages `tusg-site` | 中（SEO・OAuth 審査ページ） |
| `fanmap.tusg.site` | fanmap | Workers（Goandgoing53） | **大** |
| `fanmap-crm.tusg.site` | fanmap | Workers | **大**（Stripe live webhook） |
| `fanmap-agency.tusg.site` | — | **Vercel**（76.76.21.21）の残骸 | 小（`/agency` へ転送でよい） |
| `foodtap.tusg.site` | foodtap | Workers（`wrangler.toml:32`） | **大**（印刷済み QR） |
| `aim-rose.tusg.site` | aim-rose | Pages | 中（LINE Webhook / LIFF） |
| `aburiya.tusg.site` | aburiya | Pages | 中（PWA・紙のマニュアル） |
| `fansales.tusg.site` | fansales | Pages | 小 |
| `fuloco.tusg.site` | **今回のセッションに無いリポジトリ** | 解決する（Cloudflare） | 未調査 |
| `mail.tusg.site` | 各ツール | Resend 送信ドメイン | 中 |

DNS に無い（＝実在しない／記載だけ）: `clerk.fanmap.`・`status.fanmap.`・
`cf-custom-hostname.fanmap.`・`app-/order-/api-/print-…-foodtap.`・`abemanager.`・`lococreate.`。
lococreate / locoreach / meoreport の本番は `*.camomile.co.jp` で、**tusg.site に載っていない**
（ただし Google OAuth「ストアコネクト」経由で依存している。§3）。

---

## 2. 後から直せないもの（旧ドメインは解約せず 301 で残し続ける）

| 何 | 中身 | 出どころ |
|---|---|---|
| foodtap のテーブル QR | `https://foodtap.tusg.site/order/<token>`。トークンに期限なし・貼りっぱなし | `foodtap/src/app/app/store/[storeId]/tables/page.tsx:55`、`src/lib/security/qr-token.ts:11-14` |
| fanmap の POP / QR / リンク | `/s/` `/pop/` `/r/` `/b/` `/bx/`（メール内） `/p/`（Google に渡した画像） | `fanmap/apps/fanmap-app/src/lib/pop-url.ts` ほか |
| aim-rose 会員ID の案内 | 「aim-rose.tusg.site から」と画面に直書き（紙で渡している可能性） | `aim-rose/src/app/staff/customers/new/IssueCustomerForm.tsx:103` |
| aburiya の PDF マニュアル | 本文に `aburiya.tusg.site` | `aburiya/docs/manual/aburiya-kintai-manual.pdf` |
| SNS 投稿画像・キャプション | `tusg.site/hearing` が画像に焼き込み | `tusg-site/scripts/make_post.py:399` |
| LINE の過去トーク | `APP_URL/reserve` を返信に入れている | `aim-rose/src/app/api/line/webhook/route.ts:93` |

→ **tusg.site は更新し続け、パスとクエリを保ったまま 301。** 前例: fanmap は
「刷り直すまで Vercel を消さない」と決めている（`fanmap/docs/OFF_VERCEL_2026-08.md:436-443`）。
**Webhook（Stripe / LINE / Clerk）は 301 を追わない**ので、こちらは URL 自体を付け替える。

ドメインを変えると **全員ログインし直し**（全ツール cookie は host-only）。
aburiya は PWA の入れ直しも要る。

---

## 3. 外部サービスで切り替えが要るもの

### Google

**(a) Search Console**
- いま: `sc-domain:tusg.site`（DNS 認証。`meoreport/docs/oauth-consent-privacy-draft.md:498-500`）
- やること: `tusg.co.jp` を**同じ Google アカウント**でドメインプロパティとして DNS 認証 →
  301 を入れたあと、旧プロパティで「アドレス変更」→ 新しい sitemap をフル URL で送信。
  旧プロパティは消さない。
- アドレス変更ツールはトップページが 301 していることを確認するので、**301 を入れてから**。

**(b) OAuth 同意画面「ストアコネクト」（プロジェクト `fanmap-500512`・GBP API 承認済み）** — いちばん慎重に
- いま登録されているもの（`meoreport/docs/oauth-consent-privacy-draft.md:525-533`）:
  ホーム `https://tusg.site/store-connect`／プライバシー `…/store-connect-privacy`／
  利用規約 `…/store-connect-terms`／承認済みドメイン `camomile.co.jp`・`tusg.site`・`fanmap-app.vercel.app`
- **これは fanmap / lococreate / locoreach / meoreport の4ツールの Google 連携が共用している。**
  ページ URL の変更・新ドメインの追加は**再審査の対象**（同 :127, :616-622）。
- 前例（`meoreport/docs/gbp-setup-checklist.md:128-136`）: camomile.co.jp を足したときは
  **先に Search Console で所有権を取っていたので再審査が走らなかった**。
  → 順番は **Search Console で tusg.co.jp を認証 → 承認済みドメインに追加**。
- URL は 301 の先ではなく**最終 URL と文字列で完全一致**させる（:336 で `.html`→308 が不一致扱いになった）。
- **`tusg.site` を承認済みドメインから外さない。** 外すと `https://fanmap.tusg.site/api/oauth/google/callback` が無効になる（:123-124）。
- ホーム／プライバシー／規約の URL を変えるかは選べる。**変えずに tusg.site のまま残す**
  （tusg.site 側で store-connect 3ページだけは 301 せずに 200 で出し続ける）のが審査上は一番安全。
  変えるなら**1回にまとめて**出す。

**(c) OAuth リダイレクト URI**: fanmap の `GOOGLE_OAUTH_REDIRECT_URI`（`fanmap/apps/fanmap-app/wrangler.jsonc:42`）。
新 URI を**追加**してから env を切り替え、旧 URI は残す。

**(d) Turnstile**（Cloudflare だが Google 系ではない）: ウィジェット「FanMap public survey」の
許可ホストが `fanmap.tusg.site` だけ（`locoreach/docs/TURNSTILE_STATE_2026-08-30.md:70`）。新ホストを足す。

### Meta

| 項目 | いま | 出どころ |
|---|---|---|
| App Domains | `fanmap.tusg.site`, `tusg.site` | `fanmap/docs/META_APP_REVIEW.md:28` |
| 有効な OAuth リダイレクト URI | fanmap の `META_OAUTH_REDIRECT_URI` | `fanmap/apps/fanmap-app/wrangler.jsonc:43` |
| プライバシー／データ削除の URL | `fanmap.tusg.site/legal/…` | `META_APP_REVIEW.md:20-24`、`fanmap/docs/HANDOFF.md:185-188` |
| 連絡先メール | `info@tusg.site`（**MX 無し**） | `META_APP_REVIEW.md:25-26` |
| 審査用アカウント | `meta-review@tusg.site` | `META_APP_REVIEW.md:201-203` |
| Website プラットフォーム | `https://fanmap.tusg.site/`（自動操作で3回失敗・未登録） | `fanmap/docs/HANDOFF.md:133,158-183` |
| LocoFlow アプリのオーナーメール | `info@tusg.site` | `tusg-site/docs/OWNED_MEDIA_AUTOPOST_2026-09.md:260` |
| Instagram プロフィールのリンク | tusg.site | 同上 |
| autopost の画像 URL | `SITE_URL=https://tusg.site` + `/assets/…`（Meta が取りに来る） | `tusg-site/wrangler.toml:18`、`.github/workflows/carousel-post.yml:104,132`、`reel-post.yml:112,135` |

- **Meta アプリ審査はまだ出していない** → 出す前に移すなら最初から tusg.co.jp で登録すればよく、二度手間が無い。
- ドメイン認証（`facebook-domain-verification`）と Pixel は**どこにも無い**。今は不要。

### それ以外（「Google と Meta だけ」では済まない）

| サービス | 何を変える | 出どころ |
|---|---|---|
| **Stripe（live）** | `https://fanmap-crm.tusg.site/api/stripe/webhook` → 既存の送信先を**編集**（新規作成しない。編集なら `whsec_` が変わらない＝コードは1秘密のままでよい） | `fanmap/docs/STRIPE_WEBHOOK_SETUP_2026-09-10.md:20,33`、`yoru-map/docs/ops/domain-move.md:148-152` |
| Stripe（foodtap） | `/api/billing/webhook` | `foodtap/src/app/api/billing/webhook/route.ts` |
| **LINE Developers** | aim-rose の Webhook `…/api/line/webhook` と **LIFF エンドポイント `…/liff`**（ドメイン不一致だと LIFF が起動しない） | `aim-rose/DEPLOY.md:131,135` |
| Clerk | Webhook endpoint。**Production instance は未作成**なので、作るときに最初から tusg.co.jp で | `fanmap/apps/fanmap-app/src/app/api/webhooks/clerk/route.ts:13` |
| Resend | `mail.tusg.co.jp` を新規認証（DKIM/SPF/`send.` MX） | §0 |
| Cloudflare Email Routing | `info@tusg.co.jp` 等の転送先（tusg.co.jp には MX がもうある。転送ルールの中身は未確認） | §0 |
| Cloudflare ゾーン設定 | SSL Full(strict)・HSTS・WAF / Rate limit（ホスト名直書き）を新ゾーンで作り直す。ゾーン作成時の Bot Preference Sync（robots.txt を書き換える）は OFF | `fanmap/docs/CLOUDFLARE_SECURITY_SETUP.md`、`yoru-map/docs/ops/domain-move.md:294-364` |

---

## 4. コード側（各リポジトリで直す所の目安）

| リポジトリ | 主な所 |
|---|---|
| tusg-site | 全 HTML の canonical / og:url / JSON-LD / mailto、`sitemap.xml`、`robots.txt`、`llms*.txt`、`og-image.svg`、`wrangler.toml`（SITE_URL・メール4つ）、workflows と `tools/*.py` の既定値、`tests/autopost.test.mjs:57`。CORS 許可には **tusg.co.jp がすでに入っている**（`functions/contact.php.js:16-21`、`functions/api/consultations.js:21-26`） |
| fanmap | `wrangler.jsonc` の env、ビルド時の `NEXT_PUBLIC_APP_URL`（**焼き込み。忘れると全ページ 500 の前例**）、`fanmap.tusg.site` 直書きの既定値 12 か所前後、ヘルプ・法務のメールアドレス、`scripts/smoke.mjs`、テスト 7 本 |
| foodtap | `wrangler.toml:32,55`、`.env.production:15-19`（焼き込み）、`src/lib/security/host.ts`、`test/host/host.test.ts`、`page.tsx:117,120` |
| aim-rose | `wrangler.toml:22`（APP_URL）、`IssueCustomerForm.tsx:103` |
| aburiya | `public/lp.html:379,622`、マニュアル |
| fansales | コードは非依存（README のみ） |
| lococreate | `.env.example:19` の From（本番 secret は要確認） |

前回の移行の教訓（`yoru-map/docs/ops/domain-move.md`）: **先にドメインを定数1か所に寄せてテストで固定**してから移すと、
棚卸し漏れが減る（それでもコード外に17ファイル残っていた）。日付入りの記録・法務文書・適用済み migration は書き換えない。

---

## 5. 決めてもらうこと（調査では決められない）

1. **サブドメインの名前**: `fanmap.tusg.co.jp` のように同じ名前で移すか。
2. **tusg.co.jp のゾーンをどのアカウントに置くか**（Workers を載せるなら Goandgoing53 側が必要）。
3. **ストアコネクトの3ページの URL を変えるか**（変えない＝再審査を避けられる、が推奨）。
4. **順番**: 影響の小さい順（tusg-site → fansales → aburiya → aim-rose → foodtap → fanmap）か、まとめてか。
5. **fuloco.tusg.site** の持ち主リポジトリ（このセッションには無い）。
6. **MX が無い件**を先に直すか（info@tusg.site が受信できていない可能性）。
