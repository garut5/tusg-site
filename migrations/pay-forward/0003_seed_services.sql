-- Pay Forward 初期シード: サービスマスタ (推奨デフォルト)
-- サービス区分と最低料金の初期値を定義。
-- 原価の明細は service_costs に別途入れる (ユーザーの実工数ヒアリング後)。
--
-- 適用方法:
--   wrangler d1 execute tusg-main --file=migrations/pay-forward/0003_seed_services.sql

INSERT INTO services (
  slug, name, short_description, long_description,
  service_type, default_min_amount, recommended_amount,
  is_published, sort_order, created_at, updated_at
) VALUES
  (
    'hp-1p',
    'ホームページ制作・運用 (1ページ)',
    '店舗・個人事業主向け 1 ページ構成の完結型 HP。制作 + 月次保守 + SSL 等込み。',
    'ランディングページ 1 枚で完結する構成。モバイル最適化、SSL、月 2 回までの軽微修正、サーバー・ドメイン管理費を含む。3 年契約・自動更新。',
    'quote_required',
    NULL,                               -- 見積後に customer_quotes.min_amount で発行
    9800,                               -- 現行の推奨価格を踏襲
    0,                                  -- 初期は非公開 (管理者が承認後に公開)
    10,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
  ),
  (
    'hp-2to6p',
    'ホームページ制作・運用 (2〜6ページ)',
    'ギャラリー / 事業内容 / 問い合わせ等を含む 2〜6 ページ構成。',
    '複数ページ構成。ギャラリー、事業紹介、ブログ的なお知らせ等。3 年契約・自動更新。',
    'quote_required',
    NULL,
    16500,
    0,
    20,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
  ),
  (
    'hp-7to12p',
    'ホームページ制作・運用 (7〜12ページ)',
    '事業ページを複数持つ中規模サイト。7〜12 ページ構成。',
    '複数事業や複数店舗に対応する中規模 HP。3 年契約・自動更新。',
    'quote_required',
    NULL,
    19800,
    0,
    30,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
  ),
  (
    'ops-mgmt',
    'MEO・AIO 運用代行プラン',
    'Google マップ運用・SNS 投稿代行・AIO 対応を月額定額で代行。',
    'MEO (Google ビジネスプロフィール) 最適化、Google マップクチコミ対応、SNS 月次投稿、AI 検索最適化までを運用代行。1 年契約。',
    'quote_required',
    NULL,
    24800,
    0,
    40,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
  ),
  (
    'saas-custom',
    'SaaS・業務システム開発',
    '自社専用の Web システム・SaaS を要件に合わせて開発。',
    '完全個別見積。要件定義 → 設計 → 実装 → 保守まで伴走。',
    'quote_required',
    NULL,
    NULL,                               -- 推奨も見積時に設定
    0,
    50,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
  ),
  (
    'it-support',
    'IT ツール導入・運用支援',
    '既製 SaaS 選定・導入・社内教育・運用改善を伴走。',
    '個別見積。ツール選定、導入支援、スタッフ教育、運用定着まで。',
    'quote_required',
    NULL,
    NULL,
    0,
    60,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
  ),
  (
    'sales-support',
    '営業支援・販売促進支援',
    '営業資料・リード獲得・商談同行等の販売促進支援。',
    '個別見積。営業戦略立案、資料制作、リード獲得、商談同行等。',
    'quote_required',
    NULL,
    NULL,
    0,
    70,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
  );
