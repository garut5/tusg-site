# 合同会社TUSG コーポレートサイト

ロリポップサーバーから **Cloudflare Pages** へ移行したコーポレートサイトのソースコードです。

```
.
├── functions/             # Cloudflare Pages Functions (動的処理)
│   └── contact.php.js     #   POST /contact.php を受けてメール送信
├── public/                # 静的サイトのソース (Cloudflare Pages の公開ディレクトリ)
│   ├── _headers           #   セキュリティヘッダ・キャッシュ設定
│   ├── _redirects         #   旧URLからのリダイレクト定義
│   └── (HTML/CSS/JS/画像) #   ★ここにロリポップから持ってきたファイルを配置
├── wrangler.toml          # Cloudflare 設定
└── package.json           # wrangler (CLI) 依存
```

---

## 1. ロリポップからファイルを持ってきて配置

ロリポップの FTP でローカルにダウンロードしたあと、**`public/` 配下にそのまま配置**してください。

```
public/
├── index.html
├── about.html
├── business.html
├── company.html
├── contact.html
├── strengths.html
├── thanks.html
├── ceo.jpg
├── logo.jpg
├── css/
├── js/
├── kuchikomi_html/
├── tusmy/
└── tusmy_html/
```

> ⚠ `contact.php` は **public/ に置かないでください**。Cloudflare Pages では PHP は動きません。
> 代わりに `functions/contact.php.js` が `/contact.php` を受け取り、Resend 経由でメール送信します。
> `index_html/` のような明らかなバックアップフォルダは持ってこなくて OK です。

### `contact.html` のフォーム送信先

フォームの `action="contact.php"` はそのまま使えます。Cloudflare Pages が
同パス `/contact.php` を Pages Function にルーティングします。

---

## 2. メール送信用に Resend を準備

`contact.php` の代替として [Resend](https://resend.com) を利用します(月3,000通まで無料)。

1. Resend に登録し、API キーを発行
2. 送信元ドメイン (例: `tusg.jp`) を Resend ダッシュボードで検証 (DNS にレコード追加)
3. **必ず** 後述の `wrangler pages secret put` で API キーを Cloudflare に登録

別サービスを使いたい場合は `functions/contact.php.js` の `sendViaResend` を
SendGrid / Amazon SES などに差し替えてください。

---

## 3. ローカルで動作確認

```bash
npm install
npx wrangler login              # 初回のみ。ブラウザで Cloudflare にログイン
npm run dev                     # http://localhost:8788 で確認
```

Functions のメール送信をローカルでテストしたい場合は `.dev.vars` を作成:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
```

(`.dev.vars` は `.gitignore` 済み)

---

## 4. Cloudflare へデプロイ

### 初回: プロジェクト作成

```bash
npx wrangler login
npx wrangler pages project create tusg-site --production-branch=main
```

### シークレットを登録

```bash
npx wrangler pages secret put RESEND_API_KEY --project-name=tusg-site
# プロンプトに API キーを貼り付け
```

### 環境変数 (公開しても良い値) を確認

`wrangler.toml` の `[vars]` を編集してください。

```toml
[vars]
CONTACT_TO_EMAIL = "info@tusg.jp"          # ★ 実際の受信メールに変更
CONTACT_FROM_EMAIL = "noreply@tusg.jp"     # ★ Resendで検証済みドメインのアドレス
CONTACT_FROM_NAME = "TUSGコーポレートサイト"
```

### デプロイ

```bash
npm run deploy                   # 本番
npm run deploy:preview           # プレビュー (preview ブランチ)
```

デプロイ後、`https://tusg-site.pages.dev` で確認できます。

---

## 5. 独自ドメイン (tusg.jp 等) を Cloudflare に向ける

1. Cloudflare ダッシュボード → Pages → `tusg-site` → **Custom domains** → `tusg.jp` を追加
2. ドメインを Cloudflare で管理していない場合: 案内された CNAME を現行 DNS に追加
3. ドメイン自体を Cloudflare に移管する場合: ネームサーバ変更 → 既存DNSレコードを移植
4. 完全に Cloudflare に切り替わったら、ロリポップの契約は停止可能

> 切替前にステージング URL でフォーム送信まで通ることを必ず確認してください。

---

## 6. GitHub と連携した自動デプロイ (任意)

Cloudflare Pages ダッシュボード → Pages → `tusg-site` → **Settings → Builds & deployments** で
GitHub リポジトリ `garut5/tusg-site` を接続すれば、`main` への push で自動デプロイされます。
その場合 `wrangler pages deploy` を手動で叩く必要はなくなります。

- Build command: (空欄)
- Build output directory: `public`
- Root directory: `/`

---

## トラブルシュート

| 症状 | 対処 |
| --- | --- |
| フォーム送信で 500 が返る | `wrangler pages deployment tail --project-name=tusg-site` でログを確認。`RESEND_API_KEY` 未設定が最多。 |
| メールが届かない | Resend ダッシュボードの「Logs」で配送状態を確認。送信元ドメインのDNS検証が完了しているか。 |
| 旧URLで 404 | `public/_redirects` にリダイレクト行を追加。 |
