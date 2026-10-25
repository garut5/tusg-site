# Cloudflare Access One-time PIN セットアップ

管理画面 (`/admin/*` と `/api/admin/*`) をメール OTP (ワンタイムコード) で保護します。
**パスワードは一切使いません。** ログインしたい時に `goandgoing53@gmail.com` に 6 桁コードが届く仕組みです。

所要時間: 約 10 分 (初回のみ)

---

## 全体の流れ

```
① Zero Trust (Access) を初期化 (未使用アカウントの場合)
    ↓
② One-time PIN プロバイダを有効化
    ↓
③ Access Application を作成 (保護対象 URL を指定)
    ↓
④ Policy を作成 (goandgoing53@gmail.com を allowlist)
    ↓
⑤ 動作確認 (プライベートウィンドウでログイン)
```

---

## ① Zero Trust ダッシュボードに入る

1. Cloudflare Dashboard (https://dash.cloudflare.com/) にログイン
2. 左サイドバーで **「Zero Trust」** をクリック
   - 初めての場合は「チーム名」を聞かれる → 任意 (例: `tusg`) で登録
   - Free プラン (50 ユーザまで無料) を選択

Zero Trust のホーム画面が開けば OK。

---

## ② Identity provider として One-time PIN を有効化

Zero Trust ダッシュボードで:

1. 左メニュー → **Settings** → **Authentication**
2. **Login methods** セクション → **Add new**
3. 一覧から **「One-time PIN」** を選択
4. **Save** をクリック

これだけで、Access のログイン画面で「メールアドレスを入れて → 6 桁コード受信 → ログイン」が可能になります。
(Google OAuth 等の他のプロバイダは不要。One-time PIN だけで十分)

---

## ③ Access Application を作成

Zero Trust ダッシュボードで:

1. 左メニュー → **Access** → **Applications**
2. **Add an application** ボタン → **Self-hosted** を選択

### Application 設定 (入力項目)

| 項目 | 値 |
|---|---|
| Application name | `TUSG Admin` |
| Session Duration | `24 hours` (ログイン後 24 時間は再認証不要) |
| Application domain | `tusg.co.jp` を選択 (ドメインリストから) |
| Path | `admin` (つまり `tusg.co.jp/admin/*` を保護) |

**Add additional domains and paths** をクリックして **2 つ目のパス** も追加:

| 項目 | 値 |
|---|---|
| Domain | `tusg.co.jp` |
| Path | `api/admin` |

`Next` をクリック。

---

## ④ Policy の設定

Policy 名: `Allow TUSG admins`
Action: **Allow**
Session duration: Same as application

### Configure rules

- **Include**:
  - Selector: **Emails**
  - Value: `goandgoing53@gmail.com`

(複数の管理者を追加したい場合は **+ Add include** でもう 1 行追加)

### その他はデフォルトで

- **Require** / **Exclude** は空のまま
- `Next` → `Next` → `Add application`

---

## ⑤ 動作確認

1. ブラウザの **シークレット/プライベートウィンドウ** を開く
2. `https://tusg.co.jp/admin/` にアクセス
3. Cloudflare Access のログイン画面が表示される → メールアドレスに `goandgoing53@gmail.com` を入力
4. 「Send me a code」ボタンを押す
5. Gmail に 6 桁の数字コードが届く (件名: `Your one-time Cloudflare Access login code`)
6. その 6 桁を入れて「Sign in」
7. **管理画面** (`/admin/`) が表示される 🎉

ダッシュボード右上に `goandgoing53@gmail.com / <日時>` が出れば成功。

---

## よくあるトラブル

### "Access denied" / "You do not have permission" と出る
- Policy の Include に email が入っていない、または typo
- Policy を保存した直後は反映に 1〜2 分かかることあり

### Gmail にコードが届かない
- 迷惑メールフォルダを確認
- 送信元: `noreply@notify.cloudflare.com`
- 件名: `Your one-time Cloudflare Access login code`
- 3〜5 分待っても届かない場合は Zero Trust ダッシュボード → Logs でエラー確認

### 認証後も管理画面が 401 を返す
- API 側の `ADMIN_ALLOWED_EMAILS` に email が入っていない
- 本リポジトリでは wrangler.toml に設定済 (`goandgoing53@gmail.com`)
- 他 email も追加したい場合は wrangler.toml を編集してカンマ区切り: `"a@foo.com,b@bar.com"`

### "Cloudflare Access headers not present" のまま
- `/admin/*` が Access で保護されていない (Application の Path 設定を確認)
- Access Policy が無効化されていないか確認

---

## 管理者を追加・削除するとき

### 追加
Zero Trust → Access → Applications → `TUSG Admin` → Policies → Include に email を追加
+ `wrangler.toml` の `ADMIN_ALLOWED_EMAILS` にもカンマ区切りで追加 → 再 deploy

### 削除
上の 2 箇所から該当 email を削除 → 再 deploy

---

## セキュリティ注意事項

- 6 桁コードの有効期限は Cloudflare 側で約 10 分
- 短時間での連続試行は Cloudflare 側でレート制限される
- Gmail アカウント自体のセキュリティ (2 段階認証等) を強化しておくこと
- セッション期限 (24h) 経過後は再度 OTP 認証が必要
- 離席時はブラウザ側でログアウト推奨 (Access 側に明示的な logout URL あり:
  `https://tusg.cloudflareaccess.com/cdn-cgi/access/logout`)
