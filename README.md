# 合同会社TUSG コーポレートサイト

合同会社TUSGのコーポレートサイト (https://tusg.site/) のソースコードです。
**Cloudflare Pages** + **Pages Functions** で運用しています。

## サイト構成

```
public/
├── index.html              トップページ
├── business.html           事業内容(4本柱)
├── saas.html               SaaS開発・システム保守
├── it-support.html         ITツール導入・運用支援
├── sales.html              営業支援・販売促進支援
├── partner.html            リード・アポイント提供パートナー制度
├── compliance.html         取引方針・コンプライアンス
├── company.html            会社概要
├── contact.html            お問い合わせフォーム
├── thanks.html             送信完了
├── robots.txt
├── sitemap.xml
├── _headers                セキュリティヘッダ + キャッシュ
├── _redirects              旧URLからのリダイレクト
├── css/style.css           統一スタイル(白/緑/グレー、モバイルファースト)
├── js/main.js              モバイルメニュー + カレントナビ
└── logo.jpg

functions/
└── contact.php.js          POST /contact.php を受け Resend API で送信
```

## 技術スタック

- 静的 HTML / CSS / JavaScript (フレームワーク非依存)
- Cloudflare Pages (静的ホスティング)
- Cloudflare Pages Functions (お問い合わせフォームのバックエンド)
- Resend (フォーム→メール送信。送信元: `no-reply@mail.tusg.site`)
- Cloudflare Email Routing (受信: `info@tusg.site` → 担当メール)

## ポジショニング

合同会社TUSGは、以下を行う業務支援会社として位置づけています。

- SaaS・業務システムの企画、開発、保守
- ITツール導入・運用支援
- 営業支援・販売促進支援
- リード・アポイント取得支援
- マーケティング支援、業務改善コンサルティング、証憑管理・業務報告支援

サイトは「単なる営業代行 LP」ではなく、**法人取引に耐えるコーポレートサイト**として、
透明性のある取引方針(契約書／請求書／業務報告書／銀行振込)を明示しています。

## 改修履歴(2026/06/30 全面刷新)

- 表記を「**合同会社TUSG**」に統一(「TUSG株式会社」「TUSG合同会社」等は使用しない)
- ポジショニングを SaaS開発・IT導入・営業支援の会社として再定義
- 4本柱のサービスページを独立ページとして新設
  (`saas.html` / `it-support.html` / `sales.html` / `partner.html`)
- 取引方針・コンプライアンスページ (`compliance.html`) を新設
- 補助金不正・キャッシュバック・自己負担補填等を連想させる表現を全削除
- リード・アポイント提供パートナー制度を「透明性のある業務委託」として整理
  (補助金・助成金とは一切連動しないことを明示)
- デザインを白/緑/グレー基調の SaaS 企業デザインに刷新
- モバイルファースト、高齢の店舗経営者でも読みやすい大きめの文字
- グローバル・モバイル両ナビ、カードUI、ポリシーリスト、定義リストを統一
- SEO: 各ページに固有の title/description/canonical、`sitemap.xml`、`robots.txt`
- お問い合わせフォームの種別を新事業 4 本柱に再構成
- 旧 `about.html` / `strengths.html` は `_redirects` で 301 リダイレクト
- 個別 CSS ファイルは `style.css` に統合(6ファイル削除)
- フォーム送信は `contact.php` 互換のまま Pages Function で処理(ハニーポット付き)

---

## 開発

### ローカル

```bash
npm install
npx wrangler login
npm run dev        # http://localhost:8788
```

ローカルでフォーム送信もテストする場合は `.dev.vars` に Resend のキーを記述:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
```

### デプロイ

```bash
npm run deploy     # 本番(main)へデプロイ
npm run tail       # 直近のログを追従
```

GitHub `main` への push と連動した自動デプロイは、Cloudflare Pages ダッシュボードから
リポジトリを接続することで有効化できます。

## 環境変数 / シークレット

`wrangler.toml` の `[vars]` に平文で持つもの:

| 変数 | 値 |
|---|---|
| `CONTACT_TO_EMAIL` | `info@tusg.site` |
| `CONTACT_FROM_EMAIL` | `no-reply@mail.tusg.site` |
| `CONTACT_FROM_NAME` | `TUSGコーポレートサイト` |
| `CONTACT_REDIRECT` | `/thanks.html` |

Cloudflare のシークレット(`wrangler pages secret put` または Dashboard で設定):

| 変数 | 用途 |
|---|---|
| `RESEND_API_KEY` | Resend API キー |

## 取引方針

本サイトに掲載している取引方針(契約書・請求書・業務報告書・銀行振込に基づく取引、補助金不正・
キャッシュバック・実質無料化の禁止 等)は、運用ルールとして実際に遵守してください。
[詳細はこちら](https://tusg.site/compliance.html)
