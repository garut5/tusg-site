// お悩み・ご希望かんたん整理 — 最小単体テスト
// 実行: node tests/consultation.test.mjs
// アサーション失敗時は非0で終了。CI 未接続のため手動実行を想定。

import {
  classify,
  isAllowedPrimaryIssue,
  isAllowedOption,
  isValidEmail,
  isValidUrl,
  isValidPhone,
  sanitizeFreeText,
  generateReferenceNumber,
  generateIdempotencyKey,
} from "../public/js/consultation/logic.js";

let pass = 0, fail = 0;
function t(label, cond) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

console.log("== classify ==");
t("workflow_automation for reduce_paper_excel",
  classify({ primary_issue: "reduce_paper_excel" }).category.key === "workflow_automation");
t("requirements_discovery for unknown",
  classify({ primary_issue: "___unknown___" }).category.key === "requirements_discovery");
t("multi_tenant escalation on 2〜5拠点 + 本部",
  classify({
    primary_issue: "internal_efficiency",
    location_count: "2〜5拠点",
    user_roles: ["本部"],
  }).category.key === "multi_tenant_management");
t("custom_saas downgrades to requirements_discovery when no external users and no payment",
  classify({
    primary_issue: "build_saas",
    external_users: "利用しない",
    payment_needed: "不要",
  }).category.key === "requirements_discovery");
t("industryNote returns null for unknown industry",
  classify({ primary_issue: "reduce_paper_excel", industry: "その他" }).industryNote === null);
t("industryNote returns text for 医療・介護",
  typeof classify({ primary_issue: "reduce_paper_excel", industry: "医療・介護" }).industryNote === "string");

console.log("== isAllowed* ==");
t("primary reduce_paper_excel is allowed", isAllowedPrimaryIssue("reduce_paper_excel"));
t("primary xyz is not allowed", !isAllowedPrimaryIssue("xyz"));
t("industry 飲食 is allowed for common", isAllowedOption("industry", "飲食"));
t("industry NONEXISTENT is not allowed", !isAllowedOption("industry", "NONEXISTENT"));
t("unknown question id returns false", !isAllowedOption("nonexistent", "foo"));

console.log("== validators ==");
t("email a@b.co ok", isValidEmail("a@b.co"));
t("email long name ok", isValidEmail("very.long.name+tag@example.co.jp"));
t("email empty NG", !isValidEmail(""));
t("email no at NG", !isValidEmail("foo.bar"));
t("email length overflow NG", !isValidEmail("a".repeat(255) + "@b.co"));
t("url http ok", isValidUrl("http://example.com"));
t("url https ok", isValidUrl("https://example.com/path?q=1"));
t("url empty ok (optional)", isValidUrl(""));
t("url javascript: NG", !isValidUrl("javascript:alert(1)"));
t("phone empty ok", isValidPhone(""));
t("phone 06-6123-4567 ok", isValidPhone("06-6123-4567"));
t("phone abcdefg NG", !isValidPhone("abcdefg"));

console.log("== sanitizeFreeText ==");
// タグは剥がして本文は残す (以後 plain text として表示される前提)
t("strips HTML tags", sanitizeFreeText("<b>bold</b>hello") === "boldhello");
t("strips malformed tags", sanitizeFreeText("<script>x</script>hello") === "xhello");
t("keeps newlines", sanitizeFreeText("a\nb") === "a\nb");
t("strips NUL", sanitizeFreeText("a\x00b") === "ab");
t("truncates to maxLength", sanitizeFreeText("x".repeat(3000)).length === 2000);
t("empty for non-string", sanitizeFreeText(null) === "");

console.log("== references ==");
const ref = generateReferenceNumber(new Date("2026-07-19T00:00:00Z"), "abcd1234");
t("ref format TUSG-YYYYMMDD-XXXXXXXX", ref === "TUSG-20260719-ABCD1234");
t("idempotency-key is 32 hex chars", /^[0-9a-f]{32}$/.test(generateIdempotencyKey()));

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
