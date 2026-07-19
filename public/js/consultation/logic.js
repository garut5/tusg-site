// 30秒無料診断 — スコアリング / バリデーション / 受付番号生成
// 純粋関数のみ。DOM 参照禁止。テスト容易にする。

import {
  CATEGORIES,
  PRIMARY_ISSUES,
  COMMON_QUESTIONS,
  BRANCH_QUESTIONS,
  FREE_TEXT_CONFIG,
  INDUSTRY_NOTES,
} from "./config.js";

// ---- 結果分類ロジック ----
export function classify(answers) {
  const primaryValue = answers.primary_issue;
  const primary = PRIMARY_ISSUES.find((p) => p.value === primaryValue);
  if (!primary) {
    return { category: CATEGORIES.requirements_discovery, industryNote: null };
  }
  let categoryKey = primary.cat;

  // 追加ヒューリスティック: 業種+質問回答で微調整
  if (categoryKey === "workflow_automation") {
    if (answers.notification_needed === "必要") categoryKey = "workflow_automation";
  }
  if (categoryKey === "custom_saas") {
    if (answers.external_users === "利用しない" && answers.payment_needed === "不要") {
      // 外部利用も決済も無いなら要件整理から
      categoryKey = "requirements_discovery";
    }
  }
  if (
    (answers.location_count && /(11拠点以上|6〜10拠点|2〜5拠点)/.test(answers.location_count)) &&
    Array.isArray(answers.user_roles) &&
    answers.user_roles.some((r) => ["本部", "代理店"].includes(r)) &&
    !["multi_tenant_management", "security_operations"].includes(categoryKey)
  ) {
    categoryKey = "multi_tenant_management";
  }

  const category = CATEGORIES[categoryKey] || CATEGORIES.requirements_discovery;
  const industryNote = INDUSTRY_NOTES[answers.industry] || null;
  return { category, industryNote };
}

// ---- 選択肢の許可検証 (サーバー側でも同じロジックで再検証する想定) ----
export function isAllowedPrimaryIssue(value) {
  return PRIMARY_ISSUES.some((p) => p.value === value);
}

export function isAllowedOption(questionId, value) {
  const all = [...COMMON_QUESTIONS, ...Object.values(BRANCH_QUESTIONS).flat()];
  const q = all.find((qq) => qq.id === questionId);
  if (!q) return false;
  if (q.type === "text") return typeof value === "string" && value.length <= (q.maxLength || 300);
  if (!Array.isArray(q.options)) return false;
  return q.options.includes(value);
}

// ---- メールアドレス / URL / 電話 検証 ----
export function isValidEmail(v) {
  if (typeof v !== "string") return false;
  if (v.length > 254) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}
export function isValidUrl(v) {
  if (typeof v !== "string" || !v) return true; // 任意
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
export function isValidPhone(v) {
  if (typeof v !== "string" || !v) return true; // 任意
  return /^[\d\-+() ]{7,20}$/.test(v);
}

// ---- 自由記述サニタイズ ----
export function sanitizeFreeText(v) {
  if (typeof v !== "string") return "";
  // HTMLタグを剥がし、制御文字を除く (改行/タブは保持)
  const stripped = v
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return stripped.slice(0, FREE_TEXT_CONFIG.maxLength);
}

// ---- 受付番号生成 (推測されにくい: 日付+8文字ランダム) ----
export function generateReferenceNumber(now = new Date(), randomHex = null) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const random = randomHex || cryptoRandomHex(8);
  return `TUSG-${y}${m}${d}-${random.toUpperCase()}`;
}

function cryptoRandomHex(bytes) {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- idempotency-key 生成 ----
export function generateIdempotencyKey() {
  return cryptoRandomHex(16);
}

// ---- 表示用ヘルパ ----
export function primaryIssueLabel(value) {
  const p = PRIMARY_ISSUES.find((x) => x.value === value);
  return p ? p.label : "その他";
}
