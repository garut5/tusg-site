// 曜日 → ジャンル → キャプション生成の骨組み
//
// 7 ジャンル曜日ローテ (docs/OWNED_MEDIA_AUTOPOST_2026-09.md 参照):
//   月: MEO / 火: AIO / 水: 店舗運営×テック / 木: WEB開発
//   金: HP集客・HP開発 / 土: 失敗例 / 日: TUSG の考え
//
// MVP フェーズ:
//   キャプションだけこのファイルで生成、画像は外部 (Canva 手動 or 事前生成) から URL で渡す
//
// Phase 2 以降:
//   ・画像テンプレへの文字焼き込みを Cloudflare Images + テンプレ PNG で自動化
//   ・トピックの引き出しを LLM 経由 (Cloudflare Workers AI or Claude API) 化

export const GENRES = {
  MON: { key: "meo", label: "MEO", accent: "#F5A623" },
  TUE: { key: "aio", label: "AIO", accent: "#7B61FF" },
  WED: { key: "operation_tech", label: "店舗運営 × テック", accent: "#0EA5E9" },
  THU: { key: "web_dev", label: "WEB 開発", accent: "#22C55E" },
  FRI: { key: "hp_growth", label: "HP 集客・HP 開発", accent: "#EAB308" },
  SAT: { key: "pitfalls", label: "失敗例・落とし穴", accent: "#EF4444" },
  SUN: { key: "tusg_way", label: "TUSG の考え", accent: "#0F3D2E" },
};

const WEEKDAY_TO_GENRE = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function genreOfDate(date = new Date()) {
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jst = new Date(date.getTime() + jstOffsetMs);
  const weekday = WEEKDAY_TO_GENRE[jst.getUTCDay()];
  return { weekday, ...GENRES[weekday] };
}

const CTA_LINE = "\n👉 30秒で今の状況を整理 → https://tusg.site/hearing";

const HASHTAG_BASE = ["#TUSG", "#合同会社TUSG", "#店舗経営", "#DX", "#中小企業"];
const HASHTAG_BY_GENRE = {
  meo: ["#MEO", "#Googleマップ", "#GBP", "#ローカルSEO", "#店舗集客"],
  aio: ["#AI", "#AIO", "#AI活用", "#ChatGPT", "#生成AI"],
  operation_tech: ["#店舗運営", "#業務効率化", "#DX", "#キャッシュレス"],
  web_dev: ["#Web開発", "#SaaS", "#システム開発", "#DX事例"],
  hp_growth: ["#HP集客", "#ホームページ", "#SEO", "#LP改善", "#CV改善"],
  pitfalls: ["#失敗談", "#落とし穴", "#IT導入", "#教訓"],
  tusg_way: ["#TUSGの考え", "#経営", "#パートナー", "#理念"],
};

export function buildCaption({ title, body, genreKey }) {
  const tags = [...HASHTAG_BASE, ...(HASHTAG_BY_GENRE[genreKey] || [])];
  const hashLine = tags.join(" ");
  const parts = [];
  if (title) parts.push(`【${title}】`);
  if (body) parts.push(body);
  parts.push(CTA_LINE.trim());
  parts.push(hashLine);
  return parts.join("\n\n");
}

const CAPTION_MAX = 2200;

export function assertCaption(caption) {
  if (typeof caption !== "string") throw new Error("caption must be string");
  if (caption.length > CAPTION_MAX) {
    throw new Error(`caption too long: ${caption.length} > ${CAPTION_MAX}`);
  }
}
