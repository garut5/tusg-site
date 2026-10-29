// 補助金試算の純粋ロジック。UI には依存しない。tests/subsidy-calculator.test.mjs でカバー。
//
// 設計原則:
//   - 全金額は整数円で扱う。小数は入力時に Math.trunc で切り落とす。
//   - 補助金額は常に Math.floor(amount * rate) で切り捨て (事業者保護側に倒す)。
//   - 2/3 の計算は amount * 2 / 3 を使い、浮動小数で rate を保持しない。
//   - 「大きい」「最大」の意味を 3 種類に分離 (A: 利用者希望上限 / B: 無交付時最大想定 /
//     C: 補助上限到達の最小事業費) し、同じ変数で上書きしない。
//   - 借入金は資金繰り判定でのみ使う。経済負担 (grantNet / cashBurden) から
//     借入入金額を減算して「負担が少ない」ように見せない (返済義務+利息があるため)。

import {
  SUBSIDY_RATE_GENERAL,
  SUBSIDY_RATE_DEFICIT,
  PROGRAM_CAPS,
  ITEM_GRANT_CAPS,
  SOLO_PROHIBITED_ITEMS,
  DEFAULT_TAX_RATE,
} from "./rules.js";

export const KNOWN_ITEM_KEYS = ["web", "pr", "other"];

/** 入力値を整数円に正規化。負数・NaN・Infinity は 0 に。 */
export function toInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.trunc(v);
}

/** 補助率を定数に正規化。想定外の値はエラー。 */
export function normalizeRate(key) {
  if (key === "general" || key === SUBSIDY_RATE_GENERAL) return SUBSIDY_RATE_GENERAL;
  if (key === "deficit" || key === SUBSIDY_RATE_DEFICIT) return SUBSIDY_RATE_DEFICIT;
  throw new Error(`unknown subsidy rate: ${key}`);
}

/** 枠別の総補助上限を取得。未知の枠は normal 扱い。 */
export function programCap(programKey) {
  return PROGRAM_CAPS[programKey] ?? PROGRAM_CAPS.normal;
}

/**
 * 費目別の補助申請額を算出。費目別上限と補助率を適用。
 *   amount * 2/3 を整数で: Math.floor(amount * 2 / 3)
 *   webGrant = min(floor(web * rate), 300000)
 */
function itemGrant(amount, rate, cap) {
  const a = toInt(amount);
  if (a === 0) return 0;
  // rate 2/3 を "amount*2/3" で算出 (浮動小数誤差を回避)
  let raw;
  if (rate === SUBSIDY_RATE_GENERAL) raw = Math.floor((a * 2) / 3);
  else if (rate === SUBSIDY_RATE_DEFICIT) raw = Math.floor((a * 3) / 4);
  else raw = Math.floor(a * rate);
  if (cap != null && Number.isFinite(cap)) return Math.min(raw, cap);
  return raw;
}

/**
 * 補助金の試算。
 *
 * 入力:
 *   items: { web, pr, other }     // 税抜対象経費 (円)
 *   rateKey: "general" | "deficit"
 *   programKey: "normal" | "wage" | "business_transition" | "graduation"
 *
 * 出力:
 *   eligibleTotal, webGrant, prGrant, otherGrant, totalGrant,
 *   netTaxExcluded (= eligibleTotal - totalGrant),
 *   warnings (単独申請禁止・費目実体なし 等)
 */
export function calcGrant({ items = {}, rateKey = "general", programKey = "normal" } = {}) {
  const rate = normalizeRate(rateKey);
  const cap = programCap(programKey);
  const web = toInt(items.web);
  const pr = toInt(items.pr);
  const other = toInt(items.other);
  const eligibleTotal = web + pr + other;

  const webGrant = itemGrant(web, rate, ITEM_GRANT_CAPS.web);
  const prGrant = itemGrant(pr, rate, ITEM_GRANT_CAPS.pr);
  const otherGrant = itemGrant(other, rate, null);
  const sumItemGrants = webGrant + prGrant + otherGrant;

  // 制度全体の上限と補助率上限の両方を適用
  let rateGrant;
  if (rate === SUBSIDY_RATE_GENERAL) rateGrant = Math.floor((eligibleTotal * 2) / 3);
  else if (rate === SUBSIDY_RATE_DEFICIT) rateGrant = Math.floor((eligibleTotal * 3) / 4);
  else rateGrant = Math.floor(eligibleTotal * rate);

  const totalGrant = Math.min(cap, rateGrant, sumItemGrants);
  const netTaxExcluded = eligibleTotal - totalGrant;

  const warnings = [];
  // 単独費目の申請は不可
  const nonzeroKeys = KNOWN_ITEM_KEYS.filter((k) => toInt(items[k]) > 0);
  if (nonzeroKeys.length === 1 && SOLO_PROHIBITED_ITEMS.has(nonzeroKeys[0])) {
    warnings.push(
      `${nonzeroKeys[0]} 単独での申請は不可。他の販路開拓対象経費 (other) が実在する場合のみ組み合わせ可能`
    );
  }
  if (eligibleTotal === 0) warnings.push("対象経費が未入力");

  return {
    eligibleTotal,
    webGrant,
    prGrant,
    otherGrant,
    totalGrant,
    netTaxExcluded,
    rateApplied: rate,
    programCap: cap,
    warnings,
  };
}

/** 税込総額を算出 (消費税は原則補助対象外。表示は税込/税抜両方)。 */
export function taxInclusive(amount, taxRate = DEFAULT_TAX_RATE) {
  return Math.floor(toInt(amount) * (1 + taxRate));
}

/**
 * 支払サマリ: 税抜事業費 + 補助金額 + 税込先払・税込差額 など
 * 補助金ゼロ時の最大想定負担も同時に算出。
 */
export function paymentSummary({ grant, taxRate = DEFAULT_TAX_RATE, additionalCashCosts = 0 } = {}) {
  const taxExcluded = grant.eligibleTotal;
  const prepaidTaxIncluded = taxInclusive(taxExcluded, taxRate);
  const grantNetTaxExcluded = taxExcluded - grant.totalGrant;
  const grantNetCashDiff = prepaidTaxIncluded - grant.totalGrant;
  const zeroGrantMax = prepaidTaxIncluded + toInt(additionalCashCosts);
  return {
    taxExcluded,
    prepaidTaxIncluded,
    grantNetTaxExcluded,         // 税抜ベースの交付後負担 (eligibleTotal - grant)
    grantNetCashDiff,            // 税込ベースの交付後現金差額 (prepaid - grant)
    zeroGrantMax,                // 補助金ゼロ時の最大想定負担
    additionalCashCosts: toInt(additionalCashCosts),
  };
}

/**
 * 逆算: 目標最終負担 → 到達可能な事業費上限を算出
 *
 * 入力:
 *   target: 円
 *   basis: "tax_excluded" (eligibleTotal - grant) | "tax_included_cash" (prepaid - grant)
 *   breakdown: { web, pr, other } の "比率" (相対値、合計0でもOK)
 *   rateKey, programKey, taxRate
 *
 * 出力:
 *   maxEligibleTotal, grant, summary, feasible (費目構成/上限で達成可能か)
 *
 * アルゴリズム:
 *   比率が全て 0 なら eligibleTotal = 0 を返す。
 *   そうでなければ、eligibleTotal を 0 から 10,000,000 の範囲で二分探索し、
 *   netBurden(eligibleTotal) <= target を満たす最大値を見つける。
 */
export function reverseByTargetNet({
  target,
  basis = "tax_included_cash",
  breakdown = { web: 0, pr: 0, other: 0 },
  rateKey = "general",
  programKey = "normal",
  taxRate = DEFAULT_TAX_RATE,
} = {}) {
  const tgt = toInt(target);
  const weights = {
    web: Math.max(0, Number(breakdown.web) || 0),
    pr: Math.max(0, Number(breakdown.pr) || 0),
    other: Math.max(0, Number(breakdown.other) || 0),
  };
  const sumW = weights.web + weights.pr + weights.other;
  if (sumW === 0) {
    return {
      maxEligibleTotal: 0,
      grant: calcGrant({ items: { web: 0, pr: 0, other: 0 }, rateKey, programKey }),
      summary: null,
      feasible: false,
      reason: "費目構成が未入力 (web / pr / other のいずれかに金額または比率を入力してください)",
    };
  }

  function burdenAt(eligibleTotal) {
    const items = {
      web: Math.floor((eligibleTotal * weights.web) / sumW),
      pr: Math.floor((eligibleTotal * weights.pr) / sumW),
      other: Math.floor((eligibleTotal * weights.other) / sumW),
    };
    const g = calcGrant({ items, rateKey, programKey });
    const net = basis === "tax_excluded"
      ? g.eligibleTotal - g.totalGrant
      : taxInclusive(g.eligibleTotal, taxRate) - g.totalGrant;
    return { net, g, items };
  }

  // 二分探索: lo (達成可能) ← hi (超過) の境界を探す
  // 上限 10,000,000 (1000万) まで。超えるケースは「指定不可」として extend しない。
  let lo = 0, hi = 10_000_000;
  // target が 0 以下なら eligibleTotal = 0 が正解
  if (tgt <= 0) {
    const r = burdenAt(0);
    return {
      maxEligibleTotal: 0,
      grant: r.g,
      summary: paymentSummary({ grant: r.g, taxRate }),
      feasible: true,
    };
  }
  if (burdenAt(hi).net <= tgt) {
    // 上限でも target を超えないほど target が大きい → hi を feasible 上限として返す
    const r = burdenAt(hi);
    return {
      maxEligibleTotal: hi,
      grant: r.g,
      summary: paymentSummary({ grant: r.g, taxRate }),
      feasible: true,
      reason: "試算上限 1,000 万円で算出。これ以上は個別見積が必要",
    };
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const { net } = burdenAt(mid);
    if (net <= tgt) lo = mid;
    else hi = mid;
  }
  const r = burdenAt(lo);
  // maxEligibleTotal は calcGrant が実際に使った合計を返す
  // (比率の floor 分割で、二分探索の lo より数円少ない値になるケースがある)
  const actualEligible = r.g.eligibleTotal;
  return {
    maxEligibleTotal: actualEligible,
    grant: r.g,
    summary: paymentSummary({ grant: r.g, taxRate }),
    feasible: actualEligible > 0,
  };
}

/**
 * 資金繰り計算
 *
 * 入力:
 *   prepaidTaxIncluded: 税込先払総額
 *   ownCash: 手元で使える自己資金
 *   loan: { amount, status }  // status: "applying" | "approved" | "received"
 *   grantReceived: 実際に交付される補助金額の想定 (満額 / 50% / 0 など)
 *
 * 出力:
 *   initialShortage, loanUsable, loanRemaining (補助金入金で返済後)
 *   feasibleToStart (発注可能か)
 *   notes
 */
export function cashflow({
  prepaidTaxIncluded,
  ownCash = 0,
  loan = { amount: 0, status: "none" },
  grantReceived = 0,
} = {}) {
  const prepaid = toInt(prepaidTaxIncluded);
  const own = toInt(ownCash);
  const loanAmount = toInt(loan?.amount);
  const loanStatus = (loan?.status || "none").toLowerCase();
  const loanIsReceived = loanStatus === "received";
  const loanUsable = loanIsReceived ? loanAmount : 0;
  const totalUsable = own + loanUsable;
  const initialShortage = Math.max(0, prepaid - totalUsable);
  const grant = toInt(grantReceived);
  const loanRemaining = loanIsReceived
    ? Math.max(0, loanAmount - Math.min(loanAmount, grant))
    : loanAmount; // 未入金なら元本そのまま (借入契約があれば)
  const feasibleToStart = initialShortage === 0;

  const notes = [];
  if (loanStatus === "applying") notes.push("融資は申請中。入金前は使える資金に含めない。");
  if (loanStatus === "approved" && !loanIsReceived) {
    notes.push("融資は承認済だが入金前。入金が確認できるまで使える資金に含めない。");
  }
  if (loanAmount > 0 && loanIsReceived) {
    notes.push("借入は返済義務あり。利息・手数料は別途発生。補助金交付の遅延・減額時は返済に補助金を充当できない。");
  }
  if (!feasibleToStart) {
    notes.push("先払い資金が不足。資金未確保のまま発注してはならない (発注後の実績が審査対象になる)。");
  }

  return {
    prepaidTaxIncluded: prepaid,
    ownCash: own,
    loanAmount,
    loanStatus,
    loanUsable,
    totalUsable,
    initialShortage,
    grantReceived: grant,
    loanRemaining,
    feasibleToStart,
    notes,
  };
}

/**
 * 補助上限を使い切るのに必要な最小事業費と自己負担 (「C: 使い切り」ケース)
 *
 * 入力した費目構成を保ったまま、totalGrant が programCap または itemGrantCaps の
 * 制約に到達する最小 eligibleTotal を算出。
 */
export function minEligibleToMaxGrant({
  breakdown = { web: 0, pr: 0, other: 0 },
  rateKey = "general",
  programKey = "normal",
  taxRate = DEFAULT_TAX_RATE,
} = {}) {
  const w = { web: Math.max(0, Number(breakdown.web) || 0), pr: Math.max(0, Number(breakdown.pr) || 0), other: Math.max(0, Number(breakdown.other) || 0) };
  const sum = w.web + w.pr + w.other;
  if (sum === 0) return { feasible: false, reason: "費目構成が未入力" };

  // 二分探索で、grant が増加しなくなる (つまり cap に達した) 最小 eligibleTotal を探す
  let lo = 0, hi = 10_000_000;
  const grantAt = (et) => {
    const items = {
      web: Math.floor((et * w.web) / sum),
      pr: Math.floor((et * w.pr) / sum),
      other: Math.floor((et * w.other) / sum),
    };
    return calcGrant({ items, rateKey, programKey });
  };
  const topGrant = grantAt(hi).totalGrant;
  // より小さい eligibleTotal で同じ grant を実現できるか探す
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const g = grantAt(mid);
    if (g.totalGrant >= topGrant) hi = mid;
    else lo = mid;
  }
  const final = grantAt(hi);
  return {
    feasible: true,
    minEligibleTotal: final.eligibleTotal,
    grant: final,
    summary: paymentSummary({ grant: final, taxRate }),
  };
}
