# 管理画面の立ち上げ手順

Pay Forward 管理画面 (`/admin/`) を使い始めるための初期設定。
おおむね 30 分程度で完了します。

---

## 1. D1 データベースの作成 (1 度だけ)

**ローカルから Cloudflare にデータベースを作ります。**

```bash
cd /home/user/tusg-site
npx wrangler d1 create tusg-main
```

→ 以下のような出力が得られます:

```
✅ Successfully created DB 'tusg-main'
Add the following to your wrangler.toml:
[[d1_databases]]
binding = "TUSG_DB"
database_name = "tusg-main"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### `wrangler.toml` の該当ブロックを有効化

`wrangler.toml` 内の以下 4 行の **コメントアウトを外し**、`database_id` に上で返された UUID を貼ります。

```toml
[[d1_databases]]
binding = "TUSG_DB"
database_name = "tusg-main"
database_id = "<ここに貼る>"
```

### スキーマとシードを適用

```bash
npx wrangler d1 execute tusg-main --remote --file=migrations/pay-forward/0001_init.sql
npx wrangler d1 execute tusg-main --remote --file=migrations/pay-forward/0002_seed_assumptions.sql
npx wrangler d1 execute tusg-main --remote --file=migrations/pay-forward/0003_seed_services.sql
```

---

## 2. Cloudflare Access で `/admin/*` を保護 (1 度だけ)

Cloudflare Dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application**

| 項目 | 値 |
|---|---|
| Type | Self-hosted |
| Application name | `TUSG Admin` |
| Session Duration | 24 hours |
| Application domain | `tusg.co.jp` |
| Path | `/admin/*` |
| （追加） | `/api/admin/*` |

**Policy** (次のステップ):
| 項目 | 値 |
|---|---|
| Policy name | `Allow TUSG admins` |
| Action | `Allow` |
| Session duration | `Same as application` |
| Configure rules | **Emails: `info@tusg.co.jp` のみ (他に許可する email があれば追記)** |

**Identity providers** に **One-time PIN** が有効になっていることを確認 (無料で使えるメール OTP)。
また、必要なら **Google** を追加して Google アカウントでログインできるようにしてください。

### 動作確認

ブラウザのプライベートウィンドウで `https://tusg.co.jp/admin/` を開くと、
Access のログイン画面 (email 入力) が表示されます。
OTP メールが届いたら 6 桁コードを入れてログイン、管理画面が表示されれば OK。

---

## 3. Pages 側の環境変数 (allowlist)

Cloudflare Dashboard → **Workers & Pages** → **tusg-site** → **Settings** → **Environment variables**
→ **Production** 環境

| 変数名 | 値 | タイプ |
|---|---|---|
| `ADMIN_ALLOWED_EMAILS` | `info@tusg.co.jp` (必要なら他もカンマ区切り) | Plain |

**Access だけでも守られていますが、二重防御として API 側でも email を照合します。**

---

## 4. Stripe secret の登録 (TUSG 専用アカウント)

Dashboard → Stripe (TUSG 用アカウントで) → **Developers** → **API keys**

まずは **テストモード** のキーを使うのを推奨します。

```bash
# テストキーで secret 登録
echo "sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | npx wrangler pages secret put TUSG_STRIPE_SECRET_KEY --project-name=tusg-site
echo "pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | npx wrangler pages secret put TUSG_STRIPE_PUBLISHABLE_KEY --project-name=tusg-site
```

(Webhook secret は後述の Webhook エンドポイント設定後に取得します)

---

## 5. 再デプロイ

```bash
npx wrangler pages deploy public --project-name=tusg-site --branch=main
```

デプロイ完了後、`https://tusg.co.jp/admin/` にアクセスし、
ダッシュボードのステータスカードが **D1 (TUSG_DB) ✓ 設定済** / **Stripe Secret ✓ 設定済** になっていれば OK。

---

## 6. 使い方

### 6.1 原価前提値を入力
「原価前提値」タブで時給レート・粗利目標・解約率等を入力して保存。

### 6.2 サービスごとの原価登録
「サービス」タブで各サービスの「原価」ボタンを押し、以下を順に追加:

- 初期制作工数 (labor_initial): hours を入れる
- 月次保守工数 (labor_monthly): hours を入れる
- 月額インフラ固定費 (infra_monthly): amount を入れる (サービス固有分のみ)
- 変動費 (variable): amount + unit=per_customer_month

### 6.3 最低料金の計算と公開
「料金計算」タブでサービスを選び「計算する」→ 内訳が表示される → 問題なければ「この最低料金で公開」。

### 6.4 サービスを公開
「サービス」タブで該当サービスを「編集」→「公開中」にチェック → 保存。
`/pay-forward.html` のサービス一覧に表示されます (API 経由で読み込まれるため即時反映)。

### 6.5 個別見積の発行 (quote_required サービス用)
「個別見積」タブ →「+ 新規発行」→ 顧客情報と最低額を入れて発行。
一覧の「URL コピー」で顧客専用 URL を取得し、メール等で顧客に送付。

---

## 7. Pay Forward 公開 (Phase 6)

全て準備が整ったら:

```toml
# wrangler.toml の [vars]
PAY_FORWARD_ENABLED = "true"
```

を変更して再デプロイ。これで `/api/pay-forward/*` が有効化され、顧客からの申込を受け付けます。

**注**: `checkout.js` と `webhook.js` の実装自体はまだ skeleton です (Phase 4 で完成)。
現状は管理画面での CRUD と最低料金計算のみ機能。

---

## 8. トラブルシューティング

### 管理画面を開くと "D1 (TUSG_DB) ✗ 未設定" と出る
- `wrangler.toml` の D1 ブロックのコメントアウトを外し忘れていないか
- `database_id` が貼られているか
- 再デプロイ後に反映されているか (`https://tusg.co.jp/api/admin/me` で確認可)

### 管理画面を開くと 401 "no_access_headers"
- Cloudflare Access で `/admin/*` と `/api/admin/*` を Protect していない
- ブラウザが Access 認証に通ってない (プライベートウィンドウで再試行)

### API が 403 "not_allowed"
- `ADMIN_ALLOWED_EMAILS` に自分の email が入っていない (カンマ区切り、空白不可)

### D1 migrate で `no such table` エラー
- `--remote` を付け忘れている (ローカル D1 と Pages 側の D1 は別)
