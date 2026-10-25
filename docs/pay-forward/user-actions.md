# Pay Forward 本番公開までのユーザー作業チェックリスト

Phase 4 (実装) 以降を進める前に、ユーザー (TUSG 代表者) に以下を実施していただく必要があります。
完了したら項目にチェックを付けていってください。

---

## 1. TUSG 専用 Stripe アカウント

- [ ] **Stripe アカウント作成** (https://dashboard.stripe.com/register)
  - 事業形態「合同会社TUSG」で登録
  - **camomile のアカウントとは完全に別アカウント**
- [ ] 本人確認・銀行口座登録を完了
- [ ] 「請求」機能を有効化 (Billing は Dashboard の Settings → Billing で ON)
- [ ] テスト用 API キーを取得:
  - `sk_test_...` (Secret key)
  - `pk_test_...` (Publishable key)
- [ ] Webhook エンドポイント設定 (Phase 4 で以下の URL を登録):
  - `https://tusg.co.jp/api/pay-forward/webhook`
  - 購読イベント:
    - `checkout.session.completed`
    - `customer.subscription.created`
    - `customer.subscription.updated`
    - `customer.subscription.deleted`
    - `invoice.payment_succeeded`
    - `invoice.payment_failed`
  - `whsec_...` (Webhook signing secret) を取得

## 2. 原価情報の提供 (最低料金算出のため)

初期シード (`migrations/pay-forward/0002_seed_assumptions.sql`) は推奨デフォルト値で入っています。
以下を確定次第、SQL UPDATE で値を書き換えます。

- [ ] **時給レート** (税抜): `___` 円/h (推奨デフォルト ¥5,000)
- [ ] **粗利目標率**: `___` % (推奨デフォルト 40%)
- [ ] **想定初年度顧客数**: `___` 社 (推奨デフォルト 20)
- [ ] **想定月間解約率**: `___` % (推奨デフォルト 3%)
- [ ] **原価バッファ**: `___` % (推奨デフォルト +10%)

## 3. サービス別の実工数

HP 制作等の labor-heavy サービスは、以下の実工数データが最低料金に直結します。

- [ ] **HP 1 ページ**: 初期制作 `___` h / 月次保守 `___` h
- [ ] **HP 2〜6 ページ**: 初期制作 `___` h / 月次保守 `___` h
- [ ] **HP 7〜12 ページ**: 初期制作 `___` h / 月次保守 `___` h
- [ ] **運用代行 (MEO/AIO)**: 月次工数 `___` h

## 4. インボイス発行事業者

- [ ] 登録済み？ 登録番号: `T___________`
- [ ] 未登録の場合、Pay Forward の運用上どちらで進めるか判断
  - 税込み表示のみで BtoC メインに進める
  - BtoB 需要があるので登録申請する

## 5. Resend メール送信ドメイン (任意、推奨)

現在は `no-reply@mail.tusg.site` から送信。tusg.co.jp 統一のため切替推奨。

- [ ] Resend Dashboard で `mail.tusg.co.jp` を Verified Domain として追加
- [ ] Cloudflare DNS に以下を追加:
  - SPF (TXT, @mail): `v=spf1 include:_spf.resend.com ~all`
  - DKIM (CNAME): Resend ダッシュボードが指示する値
  - MX (任意): Return-Path 用、Resend 指示値
- [ ] 検証完了後、`wrangler.toml` の `RESEND_FROM_EMAIL` と `CONTACT_FROM_EMAIL` を `no-reply@mail.tusg.co.jp` に変更
- [ ] テスト送信して着信確認

## 6. 既存サービスの Pay Forward 対象判断

- [ ] HP 制作プラン (1p / 2-6p / 7-12p) を Pay Forward 対象にするか
- [ ] 運用代行プランを Pay Forward 対象にするか
- [ ] SaaS 開発を Pay Forward 対象にするか (すべて個別見積型)
- [ ] IT 導入支援 / 営業支援を Pay Forward 対象にするか

## 7. 管理者認証 (Cloudflare Access)

管理者画面 `/admin/*` の保護に Cloudflare Access を使用。

- [ ] Cloudflare Dashboard → Zero Trust → Access → Applications
- [ ] Application 追加:
  - Name: `TUSG Admin`
  - Domain: `tusg.co.jp/admin/*`
  - Policy: `Email in list = [info@tusg.co.jp, 代表者の Google アカウント]`
  - Session duration: 24h
- [ ] 認証プロバイダ: Google ワンタイム PIN or One-time PIN メール
- [ ] 動作確認 (/admin/ にアクセスしてログイン画面が出ること)

## 8. 本番公開前の最終承認

Phase 5 (QA 完了) 後、以下を確認したうえで Phase 6 (本番公開) 実行:

- [ ] テストモードで全フロー動作確認済 (申込・解約・金額変更・決済失敗・webhook)
- [ ] 本番 Stripe キーに差し替え
- [ ] 本番 Webhook URL 再登録
- [ ] D1 本番スキーマ適用済
- [ ] 利用規約 / 特定商取引法に基づく表示 / Pay Forward 返金ポリシー 公開
- [ ] テストカードで ¥100 等の少額決済 → 全額返金 のドライラン実施
- [ ] 管理者通知先 (`ADMIN_ALERT_EMAIL`) 確認
- [ ] `PAY_FORWARD_ENABLED = "true"` に変更して deploy

---

**完了したら、本ファイルをコミットして `[x]` チェックを付けていってください。
Claude 側では完了状況を把握できないので、口頭で「X 項目まで完了した」と教えていただければ次フェーズに進みます。**
