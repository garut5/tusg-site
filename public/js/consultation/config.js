// お悩み・ご希望かんたん整理 — 設定
// 質問・分岐・スコアリング・結果テンプレを単一の設定オブジェクトに集約。
// ロジック本体は logic.js、UI は app.js に分離。
//
// 変更時は必ず POLICY_VERSION も検討 (プライバシー同意記録が変わる場合)。

export const POLICY_VERSION = "1.0.0";

// -------- 業務カテゴリ (結果分類) --------
export const CATEGORIES = {
  workflow_automation: {
    key: "workflow_automation",
    title: "業務効率化・自動化のご相談",
    summary:
      "同じ入力の繰り返し・承認や連絡待ち・特定の担当者しか分からない業務など、日々の業務負担を減らす方向で整理できる可能性があります。",
    what_next: [
      "現在の具体的な業務手順を確認",
      "自動化できる箇所と、人の判断が必要な箇所の切り分け",
      "既存ツール (kintone / Slack / Google Workspace 等) で対応できるかの確認",
    ],
    recommend: ["現在の業務整理", "既存サービスでの対応可否確認", "必要な機能の整理"],
  },
  custom_saas: {
    key: "custom_saas",
    title: "自社専用Webシステム・SaaS開発のご相談",
    summary:
      "既存サービスでは要件を満たしにくく、自社専用の仕組みを検討する余地がある可能性があります。まずは要件を小さく絞ってからの相談をおすすめします。",
    what_next: [
      "利用者・権限・データの整理",
      "外部顧客も利用するかの確認",
      "決済・通知・連携など必要機能の整理",
    ],
    recommend: ["必要な機能の整理", "自社専用システムの開発", "権限・セキュリティ設計"],
  },
  customer_management: {
    key: "customer_management",
    title: "顧客・案件・営業情報の管理のご相談",
    summary:
      "顧客情報や案件の進捗が分散している場合、集約と可視化で見落としが減る可能性があります。CRMやSFAの導入・活用が候補になります。",
    what_next: [
      "現在の顧客情報の管理方法",
      "案件の進捗管理・履歴の必要性",
      "担当者ごとの閲覧範囲",
    ],
    recommend: ["現在の業務整理", "既存サービスでの対応可否確認", "既存システムのカスタマイズ"],
  },
  document_workflow: {
    key: "document_workflow",
    title: "契約書・見積書・請求書管理のご相談",
    summary:
      "書類の作成・承認・保管のどこに手間があるかを整理すると、電子化や共有ルールの改善につながる可能性があります。",
    what_next: [
      "管理対象の書類の種類",
      "作成・承認・保管のどの工程に負担があるか",
      "電子署名・閲覧権限の必要性",
    ],
    recommend: ["現在の業務整理", "既存サービスでの対応可否確認", "権限・セキュリティ設計"],
  },
  workforce_management: {
    key: "workforce_management",
    title: "シフト・勤怠・スタッフ管理のご相談",
    summary:
      "シフト作成・希望提出・打刻・給与集計まで、どこに負担が集中しているかを確認すると、既存の勤怠SaaS+運用改善で解決できる可能性があります。",
    what_next: [
      "現在のシフト作成・希望提出方法",
      "打刻方法と複数店舗勤務の有無",
      "給与計算集計・申請承認の必要性",
    ],
    recommend: ["現在の業務整理", "既存サービスでの対応可否確認", "必要な機能の整理"],
  },
  multi_tenant_management: {
    key: "multi_tenant_management",
    title: "本部・代理店・店舗管理のご相談",
    summary:
      "本部/代理店/店舗ごとの見え方や権限を整理する必要性が高い可能性があります。既製SaaSでは難しい場合、権限分離を持った専用システムが候補になります。",
    what_next: [
      "本部・代理店・店舗の役割と権限",
      "売上・成果集計の粒度",
      "店舗ごとの料金・プラン・情報の差異",
    ],
    recommend: ["権限・セキュリティ設計", "必要な機能の整理", "自社専用システムの開発"],
  },
  customer_engagement: {
    key: "customer_engagement",
    title: "予約・問い合わせ・SNS対応のご相談",
    summary:
      "受付や返信の負担を減らす方向で整理できる可能性があります。既存の予約SaaSやSNS運用ツールで対応できる範囲を先に確認するとよいです。",
    what_next: [
      "現在の受付方法 (Web/LINE/電話/SNS)",
      "自動返信・リマインドの必要性",
      "SNS/媒体の運用状況",
    ],
    recommend: ["現在の業務整理", "既存サービスでの対応可否確認", "外部サービスとの連携"],
  },
  data_dashboard: {
    key: "data_dashboard",
    title: "データ集計・経営の見える化のご相談",
    summary:
      "集計したい数字と、その粒度・頻度を整理すると、既存BIツールや簡易ダッシュボードで対応できるか判断できる可能性があります。",
    what_next: [
      "見たい数字の種類と粒度 (日次/週次/月次)",
      "現在の集計方法とCSV/API取得の可否",
      "店舗別・担当者別など比較の必要性",
    ],
    recommend: ["現在の業務整理", "外部サービスとの連携", "必要な機能の整理"],
  },
  security_operations: {
    key: "security_operations",
    title: "既存システム保守・セキュリティ改善のご相談",
    summary:
      "既存システムの引き継ぎ・障害対応・アカウント/権限の見直しなど、保守面の整理が優先の可能性があります。ソースコードや管理者権限の現状確認からのご相談をおすすめします。",
    what_next: [
      "現在のシステム構成とソースコードの有無",
      "管理者アカウント・アクセス権限の管理状況",
      "バックアップ・監視・障害対応の状況",
    ],
    recommend: ["現在の業務整理", "既存システムのカスタマイズ", "権限・セキュリティ設計", "開発後の保守・監視"],
  },
  requirements_discovery: {
    key: "requirements_discovery",
    title: "要件整理からのご相談",
    summary:
      "「何が課題か」「何を作れば良いか」の切り分けから一緒に整理する段階の可能性があります。断定的な結論を急がず、まず現状把握からのご相談をおすすめします。",
    what_next: [
      "現在の業務全体の棚卸し",
      "困りごとの優先度整理",
      "既存サービスでの対応可否確認",
    ],
    recommend: ["現在の業務整理", "必要な機能の整理", "既存サービスでの対応可否確認"],
  },
};

// -------- STEP 1: 最初の質問 (最も近い困りごと) --------
export const PRIMARY_ISSUES = [
  { value: "reduce_paper_excel", label: "紙・Excel・LINEでの管理を減らしたい", cat: "workflow_automation" },
  { value: "internal_efficiency", label: "社内業務を効率化・自動化したい", cat: "workflow_automation" },
  { value: "build_saas", label: "自社専用のWebシステムやSaaSを作りたい", cat: "custom_saas" },
  { value: "customer_management", label: "顧客・案件・営業情報をまとめて管理したい", cat: "customer_management" },
  { value: "document_management", label: "契約書・見積書・請求書などを管理したい", cat: "document_workflow" },
  { value: "workforce", label: "シフト・勤怠・スタッフ管理を改善したい", cat: "workforce_management" },
  { value: "multi_tenant", label: "店舗・拠点・代理店ごとに情報を管理したい", cat: "multi_tenant_management" },
  { value: "reservation", label: "予約・問い合わせ対応を自動化したい", cat: "customer_engagement" },
  { value: "sns_map", label: "InstagramやGoogleマップなどを活用したい", cat: "customer_engagement" },
  { value: "dashboard", label: "データを集計して経営状況を見えるようにしたい", cat: "data_dashboard" },
  { value: "existing_maintenance", label: "既存システムを改善・保守してほしい", cat: "security_operations" },
  { value: "security", label: "セキュリティや情報管理を改善したい", cat: "security_operations" },
  { value: "want_but_unorganized", label: "作りたいものはあるが、整理できていない", cat: "requirements_discovery" },
  { value: "dont_know", label: "何を導入すればよいか分からない", cat: "requirements_discovery" },
  { value: "other", label: "その他", cat: "requirements_discovery" },
];

// -------- 共通質問 (STEP 3で表示) --------
export const COMMON_QUESTIONS = [
  {
    id: "industry",
    label: "業種",
    required: false,
    type: "single",
    options: [
      "飲食", "美容", "小売", "ナイト店舗", "建設・現場", "不動産",
      "医療・介護", "士業", "教育", "人材", "コンサルティング",
      "IT・Web", "製造", "その他",
    ],
  },
  {
    id: "current_tools",
    label: "現在の管理方法 (複数選択可)",
    required: false,
    type: "multi",
    options: [
      "紙", "Excel", "Googleスプレッドシート", "LINE", "メール", "電話",
      "既存の業務システム", "複数のサービスを併用", "特に管理できていない", "その他",
    ],
  },
  {
    id: "user_count",
    label: "利用予定人数",
    required: false,
    type: "single",
    options: ["1人", "2〜5人", "6〜10人", "11〜30人", "31〜100人", "101人以上", "未定"],
  },
  {
    id: "location_count",
    label: "店舗・拠点数",
    required: false,
    type: "single",
    options: ["1拠点", "2〜5拠点", "6〜10拠点", "11拠点以上", "店舗・拠点はない", "未定"],
  },
  {
    id: "user_roles",
    label: "利用する立場 (複数選択可)",
    required: false,
    type: "multi",
    options: [
      "本部", "代理店", "事業者", "店舗管理者",
      "スタッフ", "顧客・一般利用者", "閲覧のみの担当者", "未定",
    ],
  },
  {
    id: "desired_timing",
    label: "希望時期",
    required: false,
    type: "single",
    options: [
      "できるだけ早く", "1か月以内", "3か月以内", "半年以内",
      "時期は決まっていない", "まずは相談したい",
    ],
  },
  {
    id: "budget",
    label: "予算感 (回答は任意)",
    required: false,
    type: "single",
    options: [
      "できるだけ費用を抑えたい",
      "月額費用を中心に検討したい",
      "初期費用を含めて相談したい",
      "内容によって検討したい",
      "補助金なども含めて検討したい",
      "まだ決めていない",
      "回答しない",
    ],
  },
];

// -------- 分岐質問 (カテゴリごと) --------
// 各カテゴリ最大3問に絞り、負担を抑える (仕様書は5〜8画面推奨)
export const BRANCH_QUESTIONS = {
  workflow_automation: [
    { id: "time_consuming", label: "特に時間がかかっている業務 (自由記述、任意)", type: "text", required: false, maxLength: 300 },
    { id: "repetitive_input", label: "同じ内容を何度も入力していますか?", type: "single", options: ["はい", "たまに", "いいえ"], required: false },
    { id: "notification_needed", label: "通知やリマインドが必要ですか?", type: "single", options: ["必要", "あると便利", "不要", "分からない"], required: false },
  ],
  custom_saas: [
    { id: "external_users", label: "外部の顧客も利用しますか?", type: "single", options: ["利用する", "利用しない", "分からない"], required: false },
    { id: "payment_needed", label: "決済機能は必要ですか?", type: "single", options: ["必要", "不要", "分からない"], required: false },
    { id: "existing_reference", label: "参考にしているサービスがあれば教えてください (任意)", type: "text", required: false, maxLength: 200 },
  ],
  customer_management: [
    { id: "progress_tracking", label: "案件の進捗を管理したいですか?", type: "single", options: ["したい", "あると便利", "不要"], required: false },
    { id: "billing_link", label: "契約・請求・入金状況も管理したいですか?", type: "single", options: ["したい", "あると便利", "不要"], required: false },
    { id: "access_control", label: "顧客情報の閲覧範囲を制限したいですか?", type: "single", options: ["したい", "あると便利", "不要"], required: false },
  ],
  document_workflow: [
    { id: "document_types", label: "管理したい書類 (自由記述、任意)", type: "text", required: false, maxLength: 200 },
    { id: "workflow_pain", label: "特に困っている工程", type: "single", options: ["作成", "編集", "承認", "保管", "検索"], required: false },
    { id: "esign_needed", label: "電子署名は必要ですか?", type: "single", options: ["必要", "検討中", "不要"], required: false },
  ],
  workforce_management: [
    { id: "shift_method", label: "シフト作成の方法", type: "single", options: ["Excel/紙", "既存の勤怠サービス", "特に管理していない", "その他"], required: false },
    { id: "punch_method", label: "打刻方法", type: "single", options: ["紙/口頭", "スマホアプリ", "ICカード", "指紋・顔認証", "その他", "未定"], required: false },
    { id: "multi_store_shift", label: "複数店舗での勤務がありますか?", type: "single", options: ["あり", "なし", "分からない"], required: false },
  ],
  multi_tenant_management: [
    { id: "hq_role", label: "本部が管理する対象 (自由記述、任意)", type: "text", required: false, maxLength: 200 },
    { id: "per_store_pricing", label: "店舗ごとの料金・プラン・クーポンが必要ですか?", type: "single", options: ["必要", "検討中", "不要"], required: false },
    { id: "aggregate_needed", label: "売上や成果の集計が必要ですか?", type: "single", options: ["必要", "検討中", "不要"], required: false },
  ],
  customer_engagement: [
    { id: "current_channel", label: "現在の受付方法", type: "multi", options: ["電話", "メール", "LINE", "Web", "Instagram", "その他"], required: false },
    { id: "auto_reply", label: "自動返信が必要ですか?", type: "single", options: ["必要", "検討中", "不要"], required: false },
    { id: "review_management", label: "口コミ管理は必要ですか?", type: "single", options: ["必要", "検討中", "不要"], required: false },
  ],
  data_dashboard: [
    { id: "metrics_wanted", label: "集計したい数字 (自由記述、任意)", type: "text", required: false, maxLength: 300 },
    { id: "aggregation_frequency", label: "頻度", type: "single", options: ["日次", "週次", "月次", "リアルタイム", "未定"], required: false },
    { id: "csv_needed", label: "CSV出力は必要ですか?", type: "single", options: ["必要", "検討中", "不要"], required: false },
  ],
  security_operations: [
    { id: "system_source", label: "ソースコードは手元にありますか?", type: "single", options: ["ある", "一部ある", "ない", "不明"], required: false },
    { id: "github_managed", label: "GitHub等で管理されていますか?", type: "single", options: ["はい", "いいえ", "分からない"], required: false },
    { id: "backup_status", label: "バックアップの状況", type: "single", options: ["定期的に取得", "不定期", "取得していない", "分からない"], required: false },
  ],
  requirements_discovery: [
    { id: "biggest_pain", label: "今一番困っていること (自由記述、任意)", type: "text", required: false, maxLength: 400 },
  ],
};

// -------- 自由記述 (最終) --------
export const FREE_TEXT_CONFIG = {
  id: "free_text",
  label: "現在のお困りごとや、実現したいことを自由にご記入ください (任意)",
  helper:
    "パスワード、秘密鍵、APIキー、クレジットカード番号、マイナンバー、医療情報などの機密情報は入力しないでください。",
  maxLength: 2000,
};

// -------- 業界別の注意書き --------
export const INDUSTRY_NOTES = {
  "医療・介護":
    "医療・介護業界では個人情報保護・要配慮個人情報の取扱いに関する追加のご確認が必要です。",
  "士業":
    "士業では顧客情報の秘匿性が高いため、権限管理と暗号化の追加確認が必要になります。",
  "ナイト店舗":
    "業種特有の法令・年齢確認・支払方法などの追加確認が必要です。",
  "建設・現場":
    "現場からの入力可否 (スマホ・オフライン) や写真管理など、追加のご確認が必要です。",
};
