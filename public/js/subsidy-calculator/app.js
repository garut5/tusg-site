// UI エントリ: 入力を取得して calc.js の純粋関数に渡し、結果カードを描画する
// ロジックは一切ここに書かない (テスト可能性と再利用性のため)

import {
  calcGrant,
  paymentSummary,
  reverseByTargetNet,
  cashflow,
  toInt,
} from "./calc.js";
import {
  RULES_VERSION,
  RULES_LAST_VERIFIED,
  RULES_PUBLIC_NOTICE_URL,
  REQUIRED_DISCLAIMERS,
} from "./rules.js";

const $ = (sel, root = document) => root.querySelector(sel);
const yen = (n) => "¥" + Number(n || 0).toLocaleString("ja-JP");

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return e;
}

function card(cls, label, value, sub) {
  return el("div", { class: `sc-card ${cls || ""}` },
    el("div", { class: "label" }, label),
    el("div", { class: "value" }, value),
    sub ? el("div", { class: "sub" }, sub) : null,
  );
}

function noteBox(cls, text) {
  return el("div", { class: `sc-note ${cls || ""}` }, text);
}

// ---------------- 初期描画 (制度バージョン / 注記) ----------------
$("#sc-rules-version").textContent = RULES_VERSION;
$("#sc-rules-verified").textContent = RULES_LAST_VERIFIED;
$("#sc-rules-url").href = RULES_PUBLIC_NOTICE_URL;
$("#sc-info-link").href = RULES_PUBLIC_NOTICE_URL;
const ul = $("#sc-disclaimers");
for (const text of REQUIRED_DISCLAIMERS) ul.appendChild(el("li", {}, text));

// ---------------- タブ切替 ----------------
const tabs = document.querySelectorAll(".sc-tabs button");
const panels = {
  reverse: $("#sc-panel-reverse"),
  cash: $("#sc-panel-cash"),
};
tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    const name = btn.dataset.tab;
    tabs.forEach((b) => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
    for (const [k, p] of Object.entries(panels)) p.hidden = k !== name;
  });
});

// ---------------- Tab A: 逆算 ----------------
$("#sc-reverse-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const target = toInt($("#rv_target").value);
  const basis = document.querySelector('input[name="basis"]:checked').value;
  const breakdown = {
    web: Number($("#rv_web").value) || 0,
    pr: Number($("#rv_pr").value) || 0,
    other: Number($("#rv_other").value) || 0,
  };
  const rateKey = $("#rv_rate").value;
  const programKey = $("#rv_program").value;
  const taxRate = Number($("#rv_tax").value) || 0.10;
  const additionalCashCosts = toInt($("#rv_additional").value);

  const r = reverseByTargetNet({ target, basis, breakdown, rateKey, programKey, taxRate });
  const summary = r.summary ? r.summary : paymentSummary({ grant: r.grant, taxRate, additionalCashCosts });
  // zeroGrantMax は additionalCashCosts を含めた形で再計算
  const summaryWithExtras = paymentSummary({ grant: r.grant, taxRate, additionalCashCosts });

  const out = $("#sc-reverse-results");
  while (out.firstChild) out.removeChild(out.firstChild);
  out.hidden = false;

  const basisLabel = basis === "tax_excluded" ? "税抜対象経費ベース" : "税込現金ベース";

  // 必須表示カード (スペック通りの順序)
  out.appendChild(card("sc-card--neutral", "① 希望する最終自己負担の上限", yen(target), basisLabel));
  out.appendChild(card("", "② 試算できる事業費の上限（税抜）", yen(summaryWithExtras.taxExcluded),
    `税込総額: ${yen(summaryWithExtras.prepaidTaxIncluded)}`));
  out.appendChild(card("", "③ 補助金の概算（交付保証なし）", yen(r.grant.totalGrant),
    `web ${yen(r.grant.webGrant)} / pr ${yen(r.grant.prGrant)} / other ${yen(r.grant.otherGrant)}（補助率 ${rateKey === "deficit" ? "3/4" : "2/3"}）`));
  out.appendChild(card("sc-card--ok", "④ 満額交付時の最終自己負担（税込現金差額）", yen(summaryWithExtras.grantNetCashDiff),
    `税抜対象経費差額: ${yen(summaryWithExtras.grantNetTaxExcluded)}`));
  out.appendChild(card("sc-card--danger", "⑤ 補助金0円時の最大想定負担", yen(summaryWithExtras.zeroGrantMax),
    additionalCashCosts > 0
      ? `税込事業費 ${yen(summaryWithExtras.prepaidTaxIncluded)} + 追加支出 ${yen(additionalCashCosts)}（追加費用の確定前は上振れし得ます）`
      : "追加費用（利息・保守・既発注分 等）が未確定の場合、この金額に加算され得ます"));
  out.appendChild(card("sc-card--warn", "⑥ 実施前に必要な先払い資金", yen(summaryWithExtras.prepaidTaxIncluded),
    "補助金は後払い。この金額を一度ご自身で支払う必要があります"));

  // 警告
  if (r.grant.warnings?.length) {
    for (const w of r.grant.warnings) out.appendChild(noteBox("sc-note--warn", "⚠ " + w));
  }
  if (!r.feasible) {
    out.appendChild(noteBox("sc-note--danger", r.reason || "指定した費目構成では目標自己負担を達成できません"));
  }
  if (r.reason && r.feasible) {
    out.appendChild(noteBox("sc-note--warn", r.reason));
  }

  // 税抜 vs 税込 の明示
  if (basis === "tax_excluded") {
    out.appendChild(noteBox("", `※ 「税抜対象経費ベースの自己負担 ${yen(target)}」は、実際には税込現金で ${yen(summaryWithExtras.grantNetCashDiff)} の差額が生じます。両者は別の金額です。`));
  } else {
    out.appendChild(noteBox("", `※ 「税込現金ベースの最終負担 ${yen(target)}」と、「税抜対象経費ベースの差額 ${yen(summaryWithExtras.grantNetTaxExcluded)}」は別の金額です。`));
  }

  out.scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------------- Tab B: 資金繰り ----------------
$("#sc-cash-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const items = {
    web: toInt($("#cf_web").value),
    pr: toInt($("#cf_pr").value),
    other: toInt($("#cf_other").value),
  };
  const rateKey = $("#cf_rate").value;
  const programKey = $("#cf_program").value;
  const taxRate = Number($("#cf_tax").value) || 0.10;
  const ownCash = toInt($("#cf_cash").value);
  const loanAmount = toInt($("#cf_loan_amount").value);
  const loanStatus = $("#cf_loan_status").value;
  const scenario = $("#cf_scenario").value;
  const additionalCashCosts = toInt($("#cf_additional").value);

  const g = calcGrant({ items, rateKey, programKey });
  const summary = paymentSummary({ grant: g, taxRate, additionalCashCosts });
  let grantReceived = g.totalGrant;
  if (scenario === "half") grantReceived = Math.floor(g.totalGrant / 2);
  if (scenario === "zero") grantReceived = 0;

  const cf = cashflow({
    prepaidTaxIncluded: summary.prepaidTaxIncluded,
    ownCash,
    loan: { amount: loanAmount, status: loanStatus },
    grantReceived,
  });

  const out = $("#sc-cash-results");
  while (out.firstChild) out.removeChild(out.firstChild);
  out.hidden = false;

  // 必須表示カード 1-8
  out.appendChild(card("sc-card--neutral", "① 対象経費合計（税抜）", yen(g.eligibleTotal),
    `web ${yen(items.web)} / pr ${yen(items.pr)} / other ${yen(items.other)}`));
  out.appendChild(card("", "② 税込先払総額（事業実施時に必要）", yen(summary.prepaidTaxIncluded),
    `消費税率 ${(taxRate * 100).toFixed(0)}%`));
  out.appendChild(card("", "③ 補助金の概算（制度上の最大）", yen(g.totalGrant),
    `web ${yen(g.webGrant)} / pr ${yen(g.prGrant)} / other ${yen(g.otherGrant)}`));
  out.appendChild(card("sc-card--ok", "④ 満額交付時の最終自己負担（税込現金差額）", yen(summary.grantNetCashDiff),
    `税抜対象経費差額: ${yen(summary.grantNetTaxExcluded)}`));
  out.appendChild(card("sc-card--danger", "⑤ 補助金0円時の最大想定負担", yen(summary.zeroGrantMax),
    "この金額を自己資金・借入で確実に支払える必要があります"));
  out.appendChild(card(cf.feasibleToStart ? "sc-card--ok" : "sc-card--danger",
    "⑥ 実施前に必要な資金 と 不足額",
    `必要 ${yen(cf.prepaidTaxIncluded)} / 不足 ${yen(cf.initialShortage)}`,
    `手元現金 ${yen(cf.ownCash)} + 入金済借入 ${yen(cf.loanUsable)} = 使える資金 ${yen(cf.totalUsable)}`));
  out.appendChild(card(
    loanStatus === "received" ? "" : (loanAmount > 0 ? "sc-card--warn" : "sc-card--neutral"),
    "⑦ 融資の状況と交付リスク",
    loanAmount > 0 ? `${yen(loanAmount)}（${{ none: "なし", applying: "申請中", approved: "承認済・未入金", received: "入金済" }[loanStatus] || loanStatus}）` : "なし",
    scenario === "zero" ? "⚠ 補助金0円シナリオ: 借入返済に補助金を充当できません"
      : scenario === "half" ? "⚠ 補助金50%減額シナリオ: 想定どおりに返済できない可能性があります"
        : (loanStatus === "received" ? `満額交付時の借入残: ${yen(cf.loanRemaining)}（利息・手数料は別途）` : "入金未確認のため、資金として算入していません")));
  out.appendChild(card("sc-card--neutral", "⑧ 月額保守等の補助対象外支出", yen(additionalCashCosts),
    "補助金額の計算には含まれません（独立に支払いが必要）"));

  // 判定サマリ
  if (!cf.feasibleToStart) {
    out.appendChild(noteBox("sc-note--danger",
      `先払い資金が ${yen(cf.initialShortage)} 不足しています。資金未確保のまま発注はできません。` +
      "手元現金を増やす・融資の実行を完了する・事業費を見直す のいずれかが必要です。"));
  }
  if (loanStatus === "applying") {
    out.appendChild(noteBox("sc-note--warn", "融資は申請中。承認・入金が確認できるまで、資金として算入していません。"));
  }
  if (scenario === "zero" && loanAmount > 0 && loanStatus === "received") {
    out.appendChild(noteBox("sc-note--danger",
      `補助金0円のシナリオでは、借入 ${yen(loanAmount)} 全額が返済義務として残ります（利息は別途）。` +
      "この場合でも、支払った 税込事業費 全額が自己負担となります。"));
  }
  if (g.warnings?.length) {
    for (const w of g.warnings) out.appendChild(noteBox("sc-note--warn", "⚠ " + w));
  }

  out.scrollIntoView({ behavior: "smooth", block: "start" });
});
