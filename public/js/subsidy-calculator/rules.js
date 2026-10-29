// 小規模事業者持続化補助金 (一般型) 制度定数
//
// 一次情報:
//   - 第20回公募要領 第8版 (2026-07-21) https://official.jizokukanb.com/shinsei
//   - 第20回 公式FAQ・参考資料 (2026-10-22)
//   - 中小企業庁・ミラサポplus 補助金の後払い https://mirasapo-plus.go.jp/hint/25788/
//   - マル経融資によるつなぎ資金活用 https://mirasapo-plus.go.jp/infomation/32093/
//
// このファイルは制度改訂時に更新する。更新時は RULES_VERSION を変更し、
// docs/subsidy-calculator-rules.md に差分と承認を記録すること。

export const RULES_VERSION = "jizokuka-r20-v8-2026-07-21";
export const RULES_LAST_VERIFIED = "2026-10-29";
export const RULES_PUBLIC_NOTICE_URL = "https://official.jizokukanb.com/shinsei";

// 消費税率 (デフォルト。軽減税率等は明示的に差替)
export const DEFAULT_TAX_RATE = 0.10;

// 補助率
// - 一般事業者: 2/3
// - 赤字事業者等: 3/4 (別途厳格判定が必要。自動適用しない)
export const SUBSIDY_RATE_GENERAL = 2 / 3;
export const SUBSIDY_RATE_DEFICIT = 3 / 4;

// 枠別の総補助上限 (単位: 円)
// - normal:     通常枠 50万
// - wage:       賃金引上げ枠 100万 (条件: 事業場内最低賃金引上げ)
// - business_transition: 卒業枠 200万
// - graduation: 卒業枠 (最大) 250万
// いずれも条件を満たさない限り使用禁止。初期値は normal を強制。
export const PROGRAM_CAPS = Object.freeze({
  normal: 500_000,
  wage: 1_000_000,
  business_transition: 2_000_000,
  graduation: 2_500_000,
});

// 費目別の「申請可能な補助金額の上限」 (単位: 円)
// - web (ウェブサイト関連費): 30万
// - pr  (広報費):             30万
// 両者とも「単独費目での申請は不可」。他に販路開拓のための対象経費が必要。
export const ITEM_GRANT_CAPS = Object.freeze({
  web: 300_000,
  pr: 300_000,
  // other 費目 (機械装置、展示会出展、委託費 等) には個別の金額上限はない
  // (総補助上限と補助率の制約のみ)
});

// 単独申請不可の費目 (他に販路開拓対象経費が必要)
export const SOLO_PROHIBITED_ITEMS = Object.freeze(new Set(["web", "pr"]));

// 補助対象外 (ユーザー入力時にチェック)
// - 利息・融資手数料: 原則対象外
// - 消費税: 原則対象外 (ただし一部例外あり — 個別判定)
// - 月額保守費: 本補助金の対象外 (運用経費)
export const NON_ELIGIBLE_NOTES = Object.freeze([
  "利息・融資手数料は原則補助対象外",
  "消費税は原則補助対象外 (例外は個別判定)",
  "月額保守費は補助対象外 (運用経費)",
  "既発注・既支払分は補助対象外 (交付決定前の発注は原則禁止)",
]);

// 法令・運用の必須注記 (出力に必ず含める)
export const REQUIRED_DISCLAIMERS = Object.freeze([
  "本試算は制度仕様に基づく概算で、採択・交付を保証するものではない",
  "補助金は交付決定後に発注し、実績報告・確定・請求を経て後払い",
  "融資は申請事業者本人の正規借入であり、入金済みと確認できるまで利用可能現金に含めない",
  "記載の「最大想定自己負担」はシナリオ範囲内の想定値であり、未確定の追加費用により増加し得る",
  "キャッシュバック・自己負担還元・名義貸し・資金循環は禁止事項 (発覚時は返還・不採択)",
]);
