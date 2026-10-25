# TUSG Pay Forward System

利用者が自分で月額料金を決める "Pay Forward 型" サブスクリプション基盤。

## 設計の核心

- **サービスは 2 分類**: `instant` (ユーザー自由入力) / `quote_required` (管理者発行トークン必須)
- **下振れ赤字防止**: HP 制作等の個別見積サービスは、管理者が顧客ごとに最低料金付きトークンを発行し、
  そのトークンがないと申込み画面にアクセスできない
- **原価の透明化**: 最低料金はインフラ + 工数 + 決済手数料 + バッファから算出し、
  計算根拠を `pricing_rules.calculation_basis` に JSON で保持
- **Stripe は TUSG 専用アカウント**: 環境変数名を `TUSG_STRIPE_*` に明示命名し camomile 社の Stripe と分離

## ディレクトリ構成

```
public/
  pay-forward.html                    LP ページ (静的)
  css/pay-forward.css                 LP 専用スタイル

functions/api/pay-forward/
  _shared.js                          共通ヘルパー (JSON, 検証, D1 クエリ)
  services.js         GET /api/pay-forward/services     公開サービス一覧
  checkout.js         POST /api/pay-forward/checkout    Stripe Checkout Session 作成
  webhook.js          POST /api/pay-forward/webhook     Stripe イベント受信

migrations/pay-forward/
  0001_init.sql                       D1 スキーマ (全テーブル)
  0002_seed_assumptions.sql           原価算出前提の初期値 (時給/利益率/等)
  0003_seed_services.sql              サービスマスタの初期シード

docs/pay-forward/
  README.md                           本書
  user-actions.md                     ユーザーが行う必要がある作業チェックリスト
```

## 段階的有効化

Pay Forward は以下 3 要素が揃った時のみ有効:

1. `wrangler.toml` の `PAY_FORWARD_ENABLED = "true"`
2. D1 バインディング `TUSG_DB` が作成・適用済み
3. Secret `TUSG_STRIPE_SECRET_KEY` が登録済み

いずれかが欠けると `/api/pay-forward/*` は 503 を返す (安全側)。
`/pay-forward.html` LP は常時公開 (サービスカードはプレースホルダ表示)。

## 開発フェーズ

- **Phase 1** 完了 ✅ : 現状調査、設計案提示
- **Phase 2** 待機 : 原価分析確定 (ユーザー入力待ち)
- **Phase 3** 待機 : 詳細設計 (API spec、画面設計)
- **Phase 4** 待機 : 実装 (checkout / webhook / 管理画面 / 顧客ポータル)
- **Phase 5** 待機 : Stripe test mode で QA
- **Phase 6** 待機 : 本番公開 (ユーザー承認後)

## 本番公開前のチェックリスト

`docs/pay-forward/user-actions.md` を参照。
