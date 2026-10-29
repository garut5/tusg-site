-- Pay Forward 個別見積の受付テーブル
-- 顧客が LP の「個別見積を依頼」ボタンから入力する内容を保存。
-- 管理者がこれを元に customer_quotes を発行する。

CREATE TABLE IF NOT EXISTS pay_forward_inquiries (
  id TEXT PRIMARY KEY,                              -- UUIDv4
  service_id INTEGER REFERENCES services(id),
  service_slug_at_submit TEXT,                      -- snapshot (後からサービス名が変わっても追える)
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_company TEXT,
  customer_phone TEXT,
  desired_pages INTEGER,                            -- HP 系サービス向け (任意)
  desired_deadline TEXT,                            -- "2027-01-31" / "特になし" 等
  budget_feel TEXT,                                 -- "~5000" / "5000-15000" / "15000-" / "unknown"
  requirements TEXT,                                -- 要件詳細 (改行可)
  source TEXT,                                      -- "lp" / "direct" 等
  status TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new', 'in_progress', 'quoted', 'rejected')),
  assigned_to TEXT,                                 -- 対応中の admin email
  quote_id TEXT REFERENCES customer_quotes(id),     -- 見積発行後にリンク
  admin_notes TEXT,                                 -- 内部メモ
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pf_inquiries_status ON pay_forward_inquiries(status, created_at);
CREATE INDEX IF NOT EXISTS idx_pf_inquiries_email ON pay_forward_inquiries(customer_email);
CREATE INDEX IF NOT EXISTS idx_pf_inquiries_service ON pay_forward_inquiries(service_id, created_at);
