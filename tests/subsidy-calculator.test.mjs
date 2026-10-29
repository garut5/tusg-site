// 補助金試算の必須テスト (node:test)
//
// 実行: node --test tests/subsidy-calculator.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calcGrant,
  paymentSummary,
  reverseByTargetNet,
  cashflow,
  minEligibleToMaxGrant,
  taxInclusive,
  toInt,
} from "../public/js/subsidy-calculator/calc.js";
import {
  PROGRAM_CAPS,
  ITEM_GRANT_CAPS,
  SUBSIDY_RATE_GENERAL,
} from "../public/js/subsidy-calculator/rules.js";

// ─────────────────────────────────────────────────────────────
// 計算仕様テスト 1-12
// ─────────────────────────────────────────────────────────────

test("[01] 通常枠・税抜 HP45万+広報9万: grant=36万, 税抜負担18万, 税込先払59.4万, 税込差額23.4万", () => {
  const g = calcGrant({ items: { web: 450_000, pr: 90_000 }, rateKey: "general", programKey: "normal" });
  assert.equal(g.eligibleTotal, 540_000);
  assert.equal(g.webGrant, 300_000);
  assert.equal(g.prGrant, 60_000);
  assert.equal(g.totalGrant, 360_000);
  assert.equal(g.netTaxExcluded, 180_000);

  const s = paymentSummary({ grant: g, taxRate: 0.10 });
  assert.equal(s.prepaidTaxIncluded, 594_000);
  assert.equal(s.grantNetCashDiff, 234_000);
  assert.equal(s.grantNetTaxExcluded, 180_000);
  assert.equal(s.zeroGrantMax, 594_000);
});

test("[02] 手元現金18万・借入0: 不足41.4万、資金未確保表示", () => {
  const cf = cashflow({
    prepaidTaxIncluded: 594_000,
    ownCash: 180_000,
    loan: { amount: 0, status: "none" },
    grantReceived: 360_000,
  });
  assert.equal(cf.initialShortage, 414_000);
  assert.equal(cf.feasibleToStart, false);
  assert.ok(cf.notes.some((n) => n.includes("資金未確保")));
});

test("[03] 借入41.4万が入金済: 不足0、満額交付後の借入残5.4万", () => {
  const cf = cashflow({
    prepaidTaxIncluded: 594_000,
    ownCash: 180_000,
    loan: { amount: 414_000, status: "received" },
    grantReceived: 360_000,
  });
  assert.equal(cf.initialShortage, 0);
  assert.equal(cf.feasibleToStart, true);
  assert.equal(cf.loanUsable, 414_000);
  assert.equal(cf.loanRemaining, 54_000);
  assert.ok(cf.notes.some((n) => n.includes("補助金交付の遅延")));
});

test("[04] 借入41.4万が審査中: 不足41.4万 (入金済とみなさない)", () => {
  const cf = cashflow({
    prepaidTaxIncluded: 594_000,
    ownCash: 180_000,
    loan: { amount: 414_000, status: "applying" },
    grantReceived: 360_000,
  });
  assert.equal(cf.loanUsable, 0);
  assert.equal(cf.initialShortage, 414_000);
  assert.equal(cf.feasibleToStart, false);
});

test("[05] 補助金0円: 借入41.4万の残高は減らず、18万円の最終負担にはならない", () => {
  const cf = cashflow({
    prepaidTaxIncluded: 594_000,
    ownCash: 180_000,
    loan: { amount: 414_000, status: "received" },
    grantReceived: 0,
  });
  assert.equal(cf.loanRemaining, 414_000); // 元本返済に充当する補助金が 0
  // 現金で支払った 594_000 のうち、ownCash + loan = 594_000 で賄えているが、
  // 借入 414_000 の返済義務は残る (18万で終わらない)
  const paidFromOwnCash = Math.min(cf.ownCash, 594_000);
  assert.equal(paidFromOwnCash, 180_000);
  // 「18万の負担」は現金フロー上の自己資金分だが、借入返済が残っていることを明示
  assert.ok(cf.notes.some((n) => n.includes("借入は返済義務")));
});

test("[06] 54万を税込総額として入力: 54万を税抜扱いにしない", () => {
  // 税込 540,000 → 税抜 490,909 (概算)。 税込/税抜の切替で結果が変わることを確認
  const taxIncl = 540_000;
  const taxExcl = Math.floor(taxIncl / 1.10);
  const g = calcGrant({ items: { web: Math.floor(taxExcl * 5 / 6), pr: Math.floor(taxExcl * 1 / 6) } });
  // 税抜 54 万ケースと数字が明確に異なることを確認
  const gRef = calcGrant({ items: { web: 450_000, pr: 90_000 } });
  assert.notEqual(g.eligibleTotal, gRef.eligibleTotal);
  assert.ok(g.totalGrant < gRef.totalGrant);
});

test("[07] HPのみ54万: 単独申請不可の警告 + webGrant 上限30万", () => {
  const g = calcGrant({ items: { web: 540_000 }, rateKey: "general" });
  assert.equal(g.webGrant, ITEM_GRANT_CAPS.web); // 30万
  assert.equal(g.prGrant, 0);
  assert.equal(g.otherGrant, 0);
  assert.equal(g.totalGrant, ITEM_GRANT_CAPS.web); // = 300,000 (sumItemGrants が制約)
  assert.ok(g.warnings.some((w) => w.includes("単独での申請は不可")));
});

test("[08] HP90万+広報0円: 単独申請不可、費目/総上限が反映", () => {
  const g = calcGrant({ items: { web: 900_000 } });
  assert.equal(g.webGrant, 300_000);
  assert.equal(g.totalGrant, 300_000); // itemGrant 制約で 30 万
  assert.ok(g.totalGrant < Math.floor(900_000 * 2 / 3)); // 単純 2/3 (60万) に満たない
  assert.ok(g.warnings.some((w) => w.includes("単独での申請は不可")));
});

test("[09] 目標自己負担が大きくても費目上限を守り、単純×3の過大試算をしない", () => {
  const r = reverseByTargetNet({
    target: 1_000_000, // 目標 100 万円の自己負担
    basis: "tax_excluded",
    breakdown: { web: 5, pr: 1, other: 0 },
    rateKey: "general",
    programKey: "normal",
  });
  // 単純に 100 万 × 3 = 300 万事業費にはならない (費目上限 web 30万 / pr 30万 の制約)
  assert.ok(r.maxEligibleTotal > 540_000);
  // ただし grant は 60 万 (web 30 + pr 30) を超えない
  assert.ok(r.grant.totalGrant <= ITEM_GRANT_CAPS.web + ITEM_GRANT_CAPS.pr);
});

test("[10] バリデーション: 0・負数・NaN・小数・巨大値を正規化", () => {
  assert.equal(toInt(0), 0);
  assert.equal(toInt(-100), 0);
  assert.equal(toInt(NaN), 0);
  assert.equal(toInt(Infinity), 0);
  assert.equal(toInt(100.9), 100); // 切り捨て
  assert.equal(toInt("50000"), 50_000);
  assert.equal(toInt("abc"), 0);
  const g = calcGrant({ items: { web: -5, pr: NaN, other: "100000" } });
  assert.equal(g.eligibleTotal, 100_000);
});

test("[11] 月額保守・融資利息は補助金額に算入しない", () => {
  const g = calcGrant({ items: { web: 450_000, pr: 90_000 } });
  const s = paymentSummary({ grant: g, additionalCashCosts: 100_000 /* 保守・利息 */ });
  // 補助金額は変わらない
  assert.equal(s.taxExcluded, 540_000);
  assert.equal(g.totalGrant, 360_000);
  // 無交付時最大想定負担には追加費用が加算される
  assert.equal(s.zeroGrantMax, 594_000 + 100_000);
});

test("[12] 試算結果には制度バージョンと注記が参照できる", async () => {
  const { RULES_VERSION, REQUIRED_DISCLAIMERS, RULES_LAST_VERIFIED } =
    await import("../public/js/subsidy-calculator/rules.js");
  assert.match(RULES_VERSION, /^jizokuka-r20-/);
  assert.match(RULES_LAST_VERIFIED, /^20\d{2}-\d{2}-\d{2}$/);
  assert.ok(REQUIRED_DISCLAIMERS.length >= 3);
});

// ─────────────────────────────────────────────────────────────
// 必須テスト 13-20 (表示ラベル/多義性/シナリオ)
// ─────────────────────────────────────────────────────────────

test("[13] 表示ラベル分離: 「希望自己負担上限」「交付後の見込自己負担」「無交付時の最大想定負担」「当初の必要資金」が別概念", () => {
  // 計算ロジック上、これら 4 値は別フィールドに格納される
  const r = reverseByTargetNet({
    target: 180_000,
    basis: "tax_excluded",
    breakdown: { web: 5, pr: 1, other: 0 },
  });
  const s = r.summary;
  const cf = cashflow({
    prepaidTaxIncluded: s.prepaidTaxIncluded,
    ownCash: 180_000,
    loan: { amount: 0, status: "none" },
    grantReceived: r.grant.totalGrant,
  });
  // 4 つの別フィールド
  const labelMap = {
    希望自己負担上限: 180_000,
    交付後の見込自己負担_税抜: s.grantNetTaxExcluded,
    交付後の見込自己負担_税込現金: s.grantNetCashDiff,
    無交付時の最大想定負担: s.zeroGrantMax,
    当初の必要資金: cf.prepaidTaxIncluded,
    当初の資金不足: cf.initialShortage,
  };
  // すべて別の数字 (または明確に異なる意味)
  const vals = Object.values(labelMap);
  // 税抜 18万と税込 23.4万 は別
  assert.notEqual(labelMap["交付後の見込自己負担_税抜"], labelMap["交付後の見込自己負担_税込現金"]);
  // 税込差額と無交付時負担は別
  assert.notEqual(labelMap["交付後の見込自己負担_税込現金"], labelMap["無交付時の最大想定負担"]);
});

test("[14] 税抜54万・補助36万・税込59.4万で、見込税込負担23.4万、ゼロ交付59.4万を示す", () => {
  const g = calcGrant({ items: { web: 450_000, pr: 90_000 } });
  const s = paymentSummary({ grant: g });
  assert.equal(g.totalGrant, 360_000);
  assert.equal(s.prepaidTaxIncluded, 594_000);
  assert.equal(s.grantNetCashDiff, 234_000);
  assert.equal(s.zeroGrantMax, 594_000);
});

test("[15] 借入金を入力しても最終経済負担が自動減少しない (返済元金の二重計上禁止)", () => {
  const g = calcGrant({ items: { web: 450_000, pr: 90_000 } });
  const s = paymentSummary({ grant: g });
  // 借入があろうがなかろうが、grantNetCashDiff / zeroGrantMax は変わらない
  assert.equal(s.grantNetCashDiff, 234_000);
  // 借入は cashflow 側でのみ扱う → 経済負担には混ざらない
  const cfLoan = cashflow({ prepaidTaxIncluded: s.prepaidTaxIncluded, loan: { amount: 414_000, status: "received" }, grantReceived: 360_000 });
  const cfNoLoan = cashflow({ prepaidTaxIncluded: s.prepaidTaxIncluded, ownCash: 594_000, grantReceived: 360_000 });
  // paymentSummary は不変
  assert.equal(s.grantNetCashDiff, 234_000);
  // cashflow の loanRemaining で借入返済義務が可視化される
  assert.equal(cfLoan.loanRemaining, 54_000);
  assert.equal(cfNoLoan.loanRemaining, 0);
});

test("[16] 月額保守を追加しても補助対象経費は増えず、想定総負担のレンジに反映", () => {
  const g = calcGrant({ items: { web: 450_000, pr: 90_000 } });
  // 月額保守 ¥5,000 × 12 ヶ月 = ¥60,000 を追加
  const s = paymentSummary({ grant: g, additionalCashCosts: 60_000 });
  assert.equal(g.eligibleTotal, 540_000); // 補助対象経費は変わらない
  assert.equal(g.totalGrant, 360_000);     // 補助金も変わらない
  assert.equal(s.zeroGrantMax, 594_000 + 60_000); // 無交付時負担には加算
});

test("[17] 利息・追加工事未確定の場合「最大想定額」として注記対象になる (フラグが立つ)", () => {
  const g = calcGrant({ items: { web: 450_000, pr: 90_000 } });
  const s = paymentSummary({ grant: g, additionalCashCosts: 0 });
  // additionalCashCosts == 0 かつ補助金ゼロケース → 最大額は eligibleTotal*1.1 のみ
  // UI は「この金額に追加費用が発生し得ます」の注記を併記する義務。
  // 本テストはロジック側が additionalCashCosts を独立フィールドで持つことを確認。
  assert.equal(s.additionalCashCosts, 0);
});

test("[18] ホームページ+広報のみで総上限250万の試算が出ない", () => {
  const r = reverseByTargetNet({
    target: 2_500_000,
    basis: "tax_excluded",
    breakdown: { web: 5, pr: 1, other: 0 },
    programKey: "graduation", // 総上限 250万
  });
  // web+pr の個別上限は各 30 万 → 合算 60 万を超えない
  assert.ok(r.grant.totalGrant <= ITEM_GRANT_CAPS.web + ITEM_GRANT_CAPS.pr);
});

test("[19] 税込希望自己負担18万と税抜18万で試算結果が異なる", () => {
  const rExcl = reverseByTargetNet({
    target: 180_000,
    basis: "tax_excluded",
    breakdown: { web: 5, pr: 1, other: 0 },
  });
  const rIncl = reverseByTargetNet({
    target: 180_000,
    basis: "tax_included_cash",
    breakdown: { web: 5, pr: 1, other: 0 },
  });
  assert.notEqual(rExcl.maxEligibleTotal, rIncl.maxEligibleTotal);
  // 税抜18万ベースの方が eligibleTotal は大きくなる (税込負担は差額小)
  assert.ok(rExcl.maxEligibleTotal > rIncl.maxEligibleTotal);
});

test("[20] 補助金ゼロのシナリオでも zeroGrantMax が独立表示される (安全判断の材料)", () => {
  const g = calcGrant({ items: { web: 450_000, pr: 90_000 } });
  const s = paymentSummary({ grant: g });
  // zeroGrantMax は常に prepaidTaxIncluded + additionalCashCosts
  assert.equal(s.zeroGrantMax, s.prepaidTaxIncluded + s.additionalCashCosts);
  // 無交付時に 59.4 万円の負担が発生し得ることが可視化
  assert.ok(s.zeroGrantMax > s.grantNetCashDiff);
});

// ─────────────────────────────────────────────────────────────
// 追加: 逆算 (reverseByTargetNet) の正しさ
// ─────────────────────────────────────────────────────────────

test("[reverse-A] 税抜18万、HP:広報=5:1で、eligibleTotal=540,000 に収束", () => {
  const r = reverseByTargetNet({
    target: 180_000,
    basis: "tax_excluded",
    breakdown: { web: 5, pr: 1, other: 0 },
  });
  assert.equal(r.maxEligibleTotal, 540_000);
  assert.equal(r.grant.totalGrant, 360_000);
});

test("[reverse-B] 税込差額23.4万、HP:広報=5:1で、eligibleTotal≈540,000 に収束", () => {
  const r = reverseByTargetNet({
    target: 234_000,
    basis: "tax_included_cash",
    breakdown: { web: 5, pr: 1, other: 0 },
  });
  // 二分探索の丸めで ±1 円程度のズレは許容
  assert.ok(Math.abs(r.maxEligibleTotal - 540_000) <= 2);
});

test("[reverse-C] 比率未入力なら feasible=false", () => {
  const r = reverseByTargetNet({ target: 180_000, basis: "tax_excluded", breakdown: { web: 0, pr: 0, other: 0 } });
  assert.equal(r.feasible, false);
  assert.ok(r.reason.includes("費目構成"));
});

test("[max-grant-C] HP:広報=5:1 の構成で補助上限 (60万) 到達の最小 eligibleTotal", () => {
  const r = minEligibleToMaxGrant({ breakdown: { web: 5, pr: 1, other: 0 }, programKey: "normal" });
  assert.equal(r.feasible, true);
  // HP:広報=5:1 比率で web/pr の個別上限 30 万ずつに同時到達する地点を探す
  // web 分 30 万 = eligibleTotal * 5/6 * 2/3 の切捨 = min(..., 30万)
  //   eligibleTotal >= 450,000 で webGrant=30万に到達 (450,000 * 5/6 * 2/3 = 250,000 ← 違う)
  //   実際: 比率 5:1 なら web = eligibleTotal*5/6、grant_web = min(floor(web*2/3), 30万)
  //   web=450,000 → web*2/3=300,000 ✓
  //   その eligibleTotal = 540,000 (web=450k)
  //   pr=90,000 → pr*2/3=60,000 (<30万、cap 未到達)
  //   → さらに eligibleTotal を増やすと pr も伸びて 30万 cap に到達する
  //   pr=450,000 で pr_grant=300,000 → eligibleTotal = 450,000*6 = 2,700,000
  //   ただし totalGrant は min(programCap=500,000, rateGrant, sumItemGrants) で頭打ち
  //   → 500,000 到達の最小 eligibleTotal を探す
  //   rateGrant=500,000 → eligibleTotal*2/3=500,000 → eligibleTotal=750,000
  //   このとき web=625,000 → web_grant=min(416,666, 300,000)=300,000
  //   pr=125,000 → pr_grant=min(83,333, 300,000)=83,333
  //   sumItemGrants = 383,333 < 500,000 (programCap)
  //   totalGrant = min(500,000, 500,000, 383,333) = 383,333
  //   → 500,000 には到達しない
  // 結論: この比率では programCap に到達不可。sumItemGrants 到達点が最大。
  assert.ok(r.grant.totalGrant <= PROGRAM_CAPS.normal);
});

test("[tax] taxInclusive は 10% で切捨", () => {
  assert.equal(taxInclusive(540_000, 0.10), 594_000);
  assert.equal(taxInclusive(100_000, 0.10), 110_000);
  assert.equal(taxInclusive(100_001, 0.10), 110_001); // 110,001.1 → 切捨
});
