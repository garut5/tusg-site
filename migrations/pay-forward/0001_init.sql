-- TUSG Pay Forward System - 初期スキーマ
--
-- 適用方法:
--   wrangler d1 create tusg-main                          # 一度だけ (DB 作成)
--   wrangler d1 execute tusg-main --file=migrations/pay-forward/0001_init.sql
--
-- 設計方針:
--   - 全金額は税抜 (JPY) の整数で保存。表示時に税込計算
--   - タイムスタンプは Unix epoch ミリ秒 (INTEGER)
--   - サービスは 2 分類: 'instant' (ユーザーが自由入力) / 'quote_required' (管理者発行トークン必須)
--   - 契約時の最低額を snapshot で保持し、原価上昇で既存契約を赤字化しない

PRAGMA foreign_keys = ON;

-- ============================================================
-- サービスマスタ
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,                      -- URL 用: 'hp-starter', 'saas-custom' 等
  name TEXT NOT NULL,                             -- 表示名
  short_description TEXT,
  long_description TEXT,                          -- Markdown 可
  service_type TEXT NOT NULL CHECK(service_type IN ('instant', 'quote_required')),
  default_min_amount INTEGER,                     -- instant 用の最低額 (税抜 円)
  recommended_amount INTEGER,                     -- 推奨額表示用
  is_published INTEGER NOT NULL DEFAULT 0 CHECK(is_published IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_services_published ON services(is_published, sort_order);

-- ============================================================
-- 原価情報 (サービス単位)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  cost_category TEXT NOT NULL CHECK(cost_category IN (
    'infra_monthly', 'variable', 'labor_initial', 'labor_monthly',
    'payment_fee', 'other'
  )),
  item_name TEXT NOT NULL,                        -- 'Cloudflare D1', '初期制作工数' 等
  amount INTEGER,                                 -- 固定額の場合 (税抜 円)
  rate REAL,                                      -- 比率の場合 (0.036 = 3.6%)
  unit TEXT CHECK(unit IN (
    'monthly', 'per_customer_month', 'per_transaction', 'one_time', 'hourly'
  )),
  hours REAL,                                     -- labor 系の工数
  source TEXT,                                    -- 出典 ('Cloudflare 公式料金 2026-10')
  verified_at INTEGER NOT NULL,
  effective_from INTEGER NOT NULL,
  effective_to INTEGER,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_service_costs_service ON service_costs(service_id, effective_from);

-- ============================================================
-- 計算前提 (想定利用量、解約率、利益率等)
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_assumptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,  -- NULL = 全体適用
  key TEXT NOT NULL,                              -- 'hourly_rate_jpy', 'profit_margin', 'churn_rate', 'expected_customers'
  value TEXT NOT NULL,
  effective_from INTEGER NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_cost_assumptions_key ON cost_assumptions(key, effective_from);

-- ============================================================
-- 最低料金ルール (計算根拠スナップショット付)
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  min_amount INTEGER NOT NULL,                    -- 税抜 円
  calculation_basis TEXT,                         -- JSON: 原価内訳のスナップショット
  effective_from INTEGER NOT NULL,
  effective_to INTEGER,
  created_by TEXT,                                -- 管理者 email
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_service ON pricing_rules(service_id, effective_from);

-- ============================================================
-- 個別見積 (quote_required サービス用)
--   管理者が顧客ごとに発行し、トークンでのみ契約画面にアクセス可能
--   これが「下振れ赤字防止」の中核テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_quotes (
  id TEXT PRIMARY KEY,                            -- UUIDv4
  service_id INTEGER NOT NULL REFERENCES services(id),
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  customer_company TEXT,
  min_amount INTEGER NOT NULL,                    -- この顧客に提示した最低額
  recommended_amount INTEGER,
  scope_description TEXT,                         -- 見積範囲の詳細
  cost_breakdown TEXT,                            -- JSON: 原価内訳
  access_token TEXT UNIQUE NOT NULL,              -- 顧客アクセストークン (256bit 相当)
  status TEXT NOT NULL CHECK(status IN ('draft', 'issued', 'consumed', 'expired', 'revoked')),
  expires_at INTEGER NOT NULL,
  issued_by TEXT,                                 -- 発行した管理者 email
  issued_at INTEGER,
  consumed_at INTEGER,                            -- 顧客が契約した日時
  revoked_at INTEGER,
  revoked_reason TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_quotes_token ON customer_quotes(access_token);
CREATE INDEX IF NOT EXISTS idx_customer_quotes_status ON customer_quotes(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_quotes_email ON customer_quotes(customer_email);

-- ============================================================
-- 顧客 (Stripe Customer と 1:1)
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_customer_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  company TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- ============================================================
-- サブスクリプション (Stripe Subscription と 1:1)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  quote_id TEXT REFERENCES customer_quotes(id),   -- quote_required 契約時のみ
  min_amount_at_contract INTEGER NOT NULL,        -- 契約時の最低額 (snapshot)
  current_amount INTEGER NOT NULL,                -- 現在の月額 (税抜 円)
  stripe_price_id TEXT NOT NULL,
  status TEXT NOT NULL,                           -- Stripe status 同期: 'active', 'past_due', 'canceled' 等
  started_at INTEGER NOT NULL,
  canceled_at INTEGER,
  cancel_at_period_end INTEGER DEFAULT 0 CHECK(cancel_at_period_end IN (0, 1)),
  next_billing_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_service ON subscriptions(service_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- 二重契約防止: 同じ顧客 × 同じサービス × active はユニーク
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_active
  ON subscriptions(customer_id, service_id)
  WHERE status IN ('active', 'trialing', 'past_due');

-- ============================================================
-- 決済履歴
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER REFERENCES subscriptions(id),
  stripe_invoice_id TEXT UNIQUE,
  stripe_charge_id TEXT,
  amount INTEGER NOT NULL,                        -- 税抜 円
  currency TEXT NOT NULL DEFAULT 'JPY',
  status TEXT NOT NULL CHECK(status IN ('succeeded', 'failed', 'refunded', 'pending', 'canceled')),
  failure_reason TEXT,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  raw_event_id TEXT                               -- 冪等性参照用
);

CREATE INDEX IF NOT EXISTS idx_payments_subscription ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at);

-- ============================================================
-- Stripe イベント (冪等性担保)
-- ============================================================
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,                            -- Stripe event.id (evt_...)
  type TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  payload TEXT                                    -- JSON (必要に応じ保持)
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type, processed_at);

-- ============================================================
-- 料金改定履歴
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  old_amount INTEGER NOT NULL,
  new_amount INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  changed_by TEXT,                                -- 'customer' | admin email | 'system'
  stripe_price_id_old TEXT,
  stripe_price_id_new TEXT,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_pricing_history_subscription ON pricing_history(subscription_id, changed_at);

-- ============================================================
-- 管理者操作ログ
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,                           -- 'service.create', 'quote.issue', 'subscription.cancel' 等
  target_type TEXT,                               -- 'service' | 'quote' | 'subscription' | ...
  target_id TEXT,
  payload TEXT,                                   -- JSON (変更内容)
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin ON admin_audit_logs(admin_email, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target ON admin_audit_logs(target_type, target_id);

-- ============================================================
-- 顧客ログイン用 Magic Link トークン
-- ============================================================
CREATE TABLE IF NOT EXISTS magic_links (
  id TEXT PRIMARY KEY,                            -- UUIDv4
  customer_email TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,                -- SHA-256 of actual token (never store raw)
  purpose TEXT NOT NULL CHECK(purpose IN ('customer_login', 'quote_access')),
  consumed_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_ip TEXT,
  used_user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_magic_links_hash ON magic_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(customer_email, created_at);

-- ============================================================
-- 顧客セッション (Magic Link ログイン後の cookie セッション管理)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_sessions (
  id TEXT PRIMARY KEY,                            -- session cookie value (random, URL-safe)
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires ON customer_sessions(expires_at);
