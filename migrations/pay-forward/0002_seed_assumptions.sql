-- Pay Forward 初期シード: 全体の原価算出前提値 (推奨デフォルト)
-- ユーザー承認後に実運用値へ置換可能。
--
-- 適用方法:
--   wrangler d1 execute tusg-main --file=migrations/pay-forward/0002_seed_assumptions.sql

-- 全体適用の前提値 (service_id = NULL)
INSERT INTO cost_assumptions (service_id, key, value, effective_from, notes) VALUES
  (NULL, 'hourly_rate_jpy', '5000',
    strftime('%s', 'now') * 1000,
    '時給レート (税抜 円)。推奨デフォルト — ユーザー承認後に実レートへ更新'),
  (NULL, 'profit_margin', '0.40',
    strftime('%s', 'now') * 1000,
    '粗利目標率 (40%)。原価×(1+margin) で最低料金を算出'),
  (NULL, 'churn_rate_monthly', '0.03',
    strftime('%s', 'now') * 1000,
    '想定月間解約率 (3%)。初期費用の按分期間計算に使用'),
  (NULL, 'expected_customers_year1', '20',
    strftime('%s', 'now') * 1000,
    '想定初年度顧客数 (20 社)。共通インフラ原価の按分計算に使用'),
  (NULL, 'cost_buffer', '0.10',
    strftime('%s', 'now') * 1000,
    '原価上昇リスクバッファ (+10%)'),
  (NULL, 'stripe_fee_jp_card', '0.0325',
    strftime('%s', 'now') * 1000,
    'Stripe 決済手数料 日本カード Visa/MC/Amex (3.25%)'),
  (NULL, 'stripe_fee_billing', '0.005',
    strftime('%s', 'now') * 1000,
    'Stripe Billing 追加手数料 (0.5%)'),
  (NULL, 'contract_amortization_months', '36',
    strftime('%s', 'now') * 1000,
    '初期制作費の按分期間 (36 ヶ月)。HP 3 年契約前提'),
  (NULL, 'infra_monthly_base_jpy', '600',
    strftime('%s', 'now') * 1000,
    '月額共通インフラ原価 (ドメイン + CF + Resend 基本枠)'),
  (NULL, 'tax_rate', '0.10',
    strftime('%s', 'now') * 1000,
    '消費税率 (表示時のみ使用、保存は税抜)');
