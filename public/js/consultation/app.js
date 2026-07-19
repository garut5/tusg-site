// お悩み・ご希望かんたん整理 — メインアプリ
// State machine + Renderer。sessionStorage で回答保持。

import {
  POLICY_VERSION,
  PRIMARY_ISSUES,
  COMMON_QUESTIONS,
  BRANCH_QUESTIONS,
  FREE_TEXT_CONFIG,
} from "./config.js";
import {
  classify,
  isValidEmail,
  isValidUrl,
  isValidPhone,
  sanitizeFreeText,
  primaryIssueLabel,
  generateIdempotencyKey,
} from "./logic.js";

const SESSION_KEY = "tusg-consultation-v1";
const START_TIMESTAMP_KEY = "tusg-consultation-started-at";
const MIN_FORM_MS = 3000; // 最低入力時間 3秒

// -------- State --------
const initialState = {
  step: "start", // start | issue | common | branch | result | contact | confirm | complete
  answers: {
    primary_issue: null,
    common: {},
    branch: {},
    free_text: "",
    contact: {
      companyName: "",
      contactName: "",
      email: "",
      phone: "",
      prefecture: "",
      websiteUrl: "",
      preferredContactMethod: "email",
      preferredContactTime: "",
    },
    consent: {
      privacy: false,
      marketing: false,
    },
  },
  result: null,
  reference: null,
  submitting: false,
  errors: {},
};

let state = load() || structuredClone(initialState);
if (!sessionStorage.getItem(START_TIMESTAMP_KEY)) {
  sessionStorage.setItem(START_TIMESTAMP_KEY, String(Date.now()));
}

function save() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch (e) { /* noop */ }
}
function load() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function reset() {
  state = structuredClone(initialState);
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.setItem(START_TIMESTAMP_KEY, String(Date.now()));
  render();
}

function setStep(step) {
  state.step = step;
  state.errors = {};
  save();
  render();
  const main = document.getElementById("consultation-main");
  if (main) main.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// -------- Renderer --------
const root = document.getElementById("consultation-root");
if (!root) {
  console.warn("[consultation] #consultation-root not found");
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

function renderProgress(currentStep) {
  const steps = [
    { key: "issue", label: "お困りごと" },
    { key: "common", label: "現在の状況" },
    { key: "branch", label: "ご希望" },
    { key: "result", label: "整理結果" },
    { key: "confirm", label: "内容確認" },
  ];
  const activeIndex = Math.max(0, steps.findIndex((s) => s.key === currentStep));
  return el("nav", { class: "wiz-progress", "aria-label": "進行状況" },
    el("ol", { class: "wiz-progress__list" },
      steps.map((s, i) =>
        el("li", { class: `wiz-progress__item${i === activeIndex ? " is-current" : ""}${i < activeIndex ? " is-done" : ""}`, "aria-current": i === activeIndex ? "step" : null },
          el("span", { class: "wiz-progress__num" }, String(i + 1)),
          el("span", { class: "wiz-progress__label" }, s.label)
        )
      )
    )
  );
}

// ---- STEP: 開始画面 ----
function renderStart() {
  return el("section", { class: "wiz-card wiz-start" },
    el("h2", { class: "wiz-h" }, "お悩み・ご希望かんたん整理"),
    el("p", { class: "wiz-lede" },
      "業務上のお困りごとや、これから実現したいことについて、簡単な質問にお答えください。回答内容をもとに、TUSGでお手伝いできる可能性のある内容を整理してご案内します。"
    ),
    el("ul", { class: "wiz-bullets" },
      el("li", null, "自分が何に困っているかを整理できます"),
      el("li", null, "どのような支援が必要そうかの目安が出ます"),
      el("li", null, "そのままご相談することもできます"),
    ),
    el("p", { class: "wiz-fineprint" },
      "回答内容は最終送信するまでサーバーに保存されません。整理結果は確定的な見積もりや契約内容ではありません。正式なご提案には、現在の運用状況などを確認させていただきます。"
    ),
    el("div", { class: "wiz-actions" },
      el("button", { type: "button", class: "btn btn--primary btn--lg", onClick: () => setStep("issue") }, "整理を始める →"),
      el("button", { type: "button", class: "btn btn--ghost", onClick: () => (location.href = "/contact.html") }, "通常のお問い合わせへ")
    ),
  );
}

// ---- STEP: 最初の質問 (困りごと) ----
function renderIssue() {
  return el("section", { class: "wiz-card" },
    el("h2", { class: "wiz-h" }, "現在のお困りごとや、実現したいことに最も近いものを選んでください"),
    el("p", { class: "wiz-hint" }, "1つを選択してください。分類の目安として使うため、迷ったら近いものを選んでいただければ大丈夫です。"),
    el("div", { class: "wiz-choice-grid" },
      PRIMARY_ISSUES.map((p) => {
        const selected = state.answers.primary_issue === p.value;
        return el("button", {
          type: "button",
          class: `wiz-choice${selected ? " is-selected" : ""}`,
          "aria-pressed": selected ? "true" : "false",
          onClick: () => {
            state.answers.primary_issue = p.value;
            save(); render();
          }
        }, p.label);
      })
    ),
    state.errors.primary_issue && el("p", { class: "wiz-error", role: "alert" }, state.errors.primary_issue),
    el("div", { class: "wiz-actions" },
      el("button", { type: "button", class: "btn btn--ghost", onClick: () => setStep("start") }, "← 戻る"),
      el("button", {
        type: "button", class: "btn btn--primary btn--lg",
        onClick: () => {
          if (!state.answers.primary_issue) {
            state.errors.primary_issue = "選択してください";
            render(); return;
          }
          setStep("common");
        }
      }, "次へ →")
    )
  );
}

// ---- 汎用: 質問カード ----
function renderQuestionField(q, store, path) {
  const val = store[q.id];
  if (q.type === "single") {
    return el("div", { class: "wiz-field", role: "group", "aria-labelledby": `q-${q.id}` },
      el("div", { id: `q-${q.id}`, class: "wiz-field__label" }, q.label),
      el("div", { class: "wiz-choice-row" },
        q.options.map((opt) => {
          const selected = val === opt;
          return el("button", {
            type: "button",
            class: `wiz-choice wiz-choice--sm${selected ? " is-selected" : ""}`,
            "aria-pressed": selected ? "true" : "false",
            onClick: () => { store[q.id] = opt; save(); render(); }
          }, opt);
        })
      )
    );
  }
  if (q.type === "multi") {
    const current = Array.isArray(val) ? val : [];
    return el("div", { class: "wiz-field", role: "group", "aria-labelledby": `q-${q.id}` },
      el("div", { id: `q-${q.id}`, class: "wiz-field__label" }, q.label),
      el("div", { class: "wiz-choice-row" },
        q.options.map((opt) => {
          const selected = current.includes(opt);
          return el("button", {
            type: "button",
            class: `wiz-choice wiz-choice--sm${selected ? " is-selected" : ""}`,
            "aria-pressed": selected ? "true" : "false",
            onClick: () => {
              store[q.id] = selected ? current.filter((x) => x !== opt) : [...current, opt];
              save(); render();
            }
          }, opt);
        })
      )
    );
  }
  if (q.type === "text") {
    return el("div", { class: "wiz-field" },
      el("label", { class: "wiz-field__label", for: `qi-${q.id}` }, q.label),
      el("textarea", {
        id: `qi-${q.id}`, class: "wiz-input wiz-input--text",
        maxlength: String(q.maxLength || 300),
        rows: "3",
        onInput: (e) => { store[q.id] = e.target.value; save(); }
      }, val || "")
    );
  }
  return null;
}

// ---- STEP: 共通質問 ----
function renderCommon() {
  const store = state.answers.common;
  return el("section", { class: "wiz-card" },
    el("h2", { class: "wiz-h" }, "現在の状況を教えてください"),
    el("p", { class: "wiz-hint" }, "分かる範囲でお答えください。全て任意です。"),
    COMMON_QUESTIONS.map((q) => renderQuestionField(q, store)),
    el("div", { class: "wiz-actions" },
      el("button", { type: "button", class: "btn btn--ghost", onClick: () => setStep("issue") }, "← 戻る"),
      el("button", {
        type: "button", class: "btn btn--primary btn--lg",
        onClick: () => setStep("branch")
      }, "次へ →")
    )
  );
}

// ---- STEP: 分岐質問 ----
function renderBranch() {
  const primary = PRIMARY_ISSUES.find((p) => p.value === state.answers.primary_issue);
  const cat = primary ? primary.cat : "requirements_discovery";
  const questions = BRANCH_QUESTIONS[cat] || [];
  const store = state.answers.branch;

  return el("section", { class: "wiz-card" },
    el("h2", { class: "wiz-h" }, "もう少しだけ、ご希望を教えてください"),
    el("p", { class: "wiz-hint" }, "整理結果の精度を上げるためのご質問です。分かる範囲でお答えください。"),
    questions.length === 0
      ? el("p", { class: "wiz-lede" }, "追加のご質問はありません。次へお進みください。")
      : questions.map((q) => renderQuestionField(q, store)),
    el("hr", { class: "wiz-divider" }),
    el("div", { class: "wiz-field" },
      el("label", { class: "wiz-field__label", for: "free-text" }, FREE_TEXT_CONFIG.label),
      el("p", { class: "wiz-hint wiz-hint--warn" }, FREE_TEXT_CONFIG.helper),
      el("textarea", {
        id: "free-text", class: "wiz-input wiz-input--text",
        maxlength: String(FREE_TEXT_CONFIG.maxLength),
        rows: "5",
        onInput: (e) => { state.answers.free_text = e.target.value; save(); }
      }, state.answers.free_text || "")
    ),
    el("div", { class: "wiz-actions" },
      el("button", { type: "button", class: "btn btn--ghost", onClick: () => setStep("common") }, "← 戻る"),
      el("button", {
        type: "button", class: "btn btn--primary btn--lg",
        onClick: () => {
          state.result = classify({
            primary_issue: state.answers.primary_issue,
            ...state.answers.common,
            ...state.answers.branch,
          });
          save();
          setStep("result");
        }
      }, "整理結果を見る →")
    )
  );
}

// ---- STEP: 整理結果 ----
function renderResult() {
  const { category, industryNote } = state.result || {};
  if (!category) {
    return el("section", { class: "wiz-card" },
      el("p", null, "整理結果を作成できませんでした。前の質問へ戻ってお試しください。"),
      el("div", { class: "wiz-actions" },
        el("button", { type: "button", class: "btn btn--ghost", onClick: () => setStep("branch") }, "← 戻る")
      )
    );
  }
  return el("section", { class: "wiz-card wiz-result" },
    el("span", { class: "wiz-signature" }, "整理結果"),
    el("h2", { class: "wiz-h wiz-h--serif" }, category.title),
    el("p", { class: "wiz-lede" }, category.summary),

    industryNote && el("div", { class: "wiz-note wiz-note--warn" },
      el("strong", null, "業種特有のご確認事項"),
      el("p", null, industryNote)
    ),

    el("h3", { class: "wiz-h3" }, "TUSGでご確認したいこと"),
    el("ul", { class: "wiz-bullets" }, category.what_next.map((s) => el("li", null, s))),

    el("h3", { class: "wiz-h3" }, "適している可能性のある支援内容"),
    el("ul", { class: "wiz-bullets" }, category.recommend.map((s) => el("li", null, s))),

    el("div", { class: "wiz-note" },
      el("strong", null, "この整理結果について"),
      el("p", null, "回答内容をもとにした参考情報です。開発可否、費用、納期、成果を保証するものではありません。業界固有の法令対応は追加のご確認が必要です。補助金の採択や対象可否、集客・売上などの成果を保証するものではありません。最終的な仕様は個別のヒアリング後に決定します。")
    ),

    el("div", { class: "wiz-actions" },
      el("button", { type: "button", class: "btn btn--ghost", onClick: () => setStep("branch") }, "← 回答を修正する"),
      el("button", {
        type: "button", class: "btn btn--primary btn--lg",
        onClick: () => setStep("contact")
      }, "この内容で相談する →")
    )
  );
}

// ---- STEP: 連絡先 ----
function renderContact() {
  const c = state.answers.contact;
  const err = state.errors;
  return el("section", { class: "wiz-card" },
    el("h2", { class: "wiz-h" }, "ご連絡先を教えてください"),
    el("p", { class: "wiz-hint" }, "*は必須項目です。ご相談への回答と必要なご連絡のためだけに利用します。"),
    el("div", { class: "wiz-field" },
      el("label", { class: "wiz-field__label", for: "c-company" }, "会社名または屋号 *"),
      el("input", { id: "c-company", type: "text", class: "wiz-input", value: c.companyName, autocomplete: "organization",
        onInput: (e) => { c.companyName = e.target.value.slice(0, 100); save(); } }),
      err.companyName && el("p", { class: "wiz-error", role: "alert" }, err.companyName)
    ),
    el("div", { class: "wiz-field" },
      el("label", { class: "wiz-field__label", for: "c-name" }, "担当者名 *"),
      el("input", { id: "c-name", type: "text", class: "wiz-input", value: c.contactName, autocomplete: "name",
        onInput: (e) => { c.contactName = e.target.value.slice(0, 60); save(); } }),
      err.contactName && el("p", { class: "wiz-error", role: "alert" }, err.contactName)
    ),
    el("div", { class: "wiz-field" },
      el("label", { class: "wiz-field__label", for: "c-email" }, "メールアドレス *"),
      el("input", { id: "c-email", type: "email", class: "wiz-input", value: c.email, autocomplete: "email", inputmode: "email",
        onInput: (e) => { c.email = e.target.value.slice(0, 254); save(); } }),
      err.email && el("p", { class: "wiz-error", role: "alert" }, err.email)
    ),
    el("details", { class: "wiz-optional" },
      el("summary", null, "任意項目を入力する (電話・都道府県・URL・希望連絡方法)"),
      el("div", { class: "wiz-optional__inner" },
        el("div", { class: "wiz-field" },
          el("label", { class: "wiz-field__label", for: "c-phone" }, "電話番号"),
          el("input", { id: "c-phone", type: "tel", class: "wiz-input", value: c.phone, autocomplete: "tel", inputmode: "tel",
            onInput: (e) => { c.phone = e.target.value.slice(0, 20); save(); } })
        ),
        el("div", { class: "wiz-field" },
          el("label", { class: "wiz-field__label", for: "c-pref" }, "都道府県"),
          el("input", { id: "c-pref", type: "text", class: "wiz-input", value: c.prefecture,
            onInput: (e) => { c.prefecture = e.target.value.slice(0, 20); save(); } })
        ),
        el("div", { class: "wiz-field" },
          el("label", { class: "wiz-field__label", for: "c-url" }, "WebサイトURL"),
          el("input", { id: "c-url", type: "url", class: "wiz-input", value: c.websiteUrl, autocomplete: "url", inputmode: "url",
            onInput: (e) => { c.websiteUrl = e.target.value.slice(0, 300); save(); } })
        ),
        el("div", { class: "wiz-field" },
          el("label", { class: "wiz-field__label" }, "希望する連絡方法"),
          el("div", { class: "wiz-choice-row" },
            ["メール", "電話", "どちらでもよい"].map((m) => {
              const val = m === "メール" ? "email" : m === "電話" ? "phone" : "any";
              const sel = c.preferredContactMethod === val;
              return el("button", {
                type: "button",
                class: `wiz-choice wiz-choice--sm${sel ? " is-selected" : ""}`,
                "aria-pressed": sel ? "true" : "false",
                onClick: () => { c.preferredContactMethod = val; save(); render(); }
              }, m);
            })
          )
        ),
        el("div", { class: "wiz-field" },
          el("label", { class: "wiz-field__label", for: "c-time" }, "連絡しやすい時間帯"),
          el("input", { id: "c-time", type: "text", class: "wiz-input", value: c.preferredContactTime, placeholder: "例: 平日午後",
            onInput: (e) => { c.preferredContactTime = e.target.value.slice(0, 60); save(); } })
        ),
      )
    ),
    el("div", { class: "wiz-actions" },
      el("button", { type: "button", class: "btn btn--ghost", onClick: () => setStep("result") }, "← 戻る"),
      el("button", {
        type: "button", class: "btn btn--primary btn--lg",
        onClick: () => {
          validateContact();
          if (Object.keys(state.errors).length > 0) { render(); return; }
          setStep("confirm");
        }
      }, "入力内容を確認する →")
    )
  );
}

function validateContact() {
  const c = state.answers.contact;
  const errors = {};
  if (!c.companyName || c.companyName.trim().length < 1) errors.companyName = "会社名または屋号を入力してください";
  if (!c.contactName || c.contactName.trim().length < 1) errors.contactName = "担当者名を入力してください";
  if (!isValidEmail(c.email)) errors.email = "正しいメールアドレスを入力してください";
  if (c.phone && !isValidPhone(c.phone)) errors.phone = "電話番号の形式が正しくありません";
  if (c.websiteUrl && !isValidUrl(c.websiteUrl)) errors.websiteUrl = "URLの形式が正しくありません";
  state.errors = errors;
}

// ---- STEP: 内容確認 ----
function renderConfirm() {
  const c = state.answers.contact;
  const consent = state.answers.consent;
  const result = state.result || {};

  const summaryLines = [];
  summaryLines.push(["優先したい内容", primaryIssueLabel(state.answers.primary_issue)]);
  if (state.answers.common.industry) summaryLines.push(["業種", state.answers.common.industry]);
  if (state.answers.common.user_count) summaryLines.push(["利用予定人数", state.answers.common.user_count]);
  if (state.answers.common.location_count) summaryLines.push(["店舗・拠点数", state.answers.common.location_count]);
  if (state.answers.common.desired_timing) summaryLines.push(["希望時期", state.answers.common.desired_timing]);
  if (state.answers.common.budget) summaryLines.push(["予算感", state.answers.common.budget]);
  if (result.category) summaryLines.push(["整理結果", result.category.title]);

  return el("section", { class: "wiz-card" },
    el("h2", { class: "wiz-h" }, "内容確認"),
    el("p", { class: "wiz-hint" }, "この内容で送信します。修正する場合は「回答内容を修正する」を押してください。"),

    el("div", { class: "wiz-review" },
      el("h3", { class: "wiz-h3" }, "回答内容"),
      el("dl", { class: "wiz-review__dl" },
        summaryLines.map(([k, v]) =>
          el("div", { class: "wiz-review__row" },
            el("dt", null, k),
            el("dd", null, v)
          )
        )
      ),
      state.answers.free_text && el("div", { class: "wiz-review__free" },
        el("h4", null, "自由記述"),
        el("p", { class: "wiz-preline" }, state.answers.free_text)
      )
    ),

    el("div", { class: "wiz-review" },
      el("h3", { class: "wiz-h3" }, "ご連絡先"),
      el("dl", { class: "wiz-review__dl" },
        el("div", { class: "wiz-review__row" }, el("dt", null, "会社名"), el("dd", null, c.companyName)),
        el("div", { class: "wiz-review__row" }, el("dt", null, "担当者名"), el("dd", null, c.contactName)),
        el("div", { class: "wiz-review__row" }, el("dt", null, "メール"), el("dd", null, c.email)),
        c.phone && el("div", { class: "wiz-review__row" }, el("dt", null, "電話番号"), el("dd", null, c.phone)),
        c.prefecture && el("div", { class: "wiz-review__row" }, el("dt", null, "都道府県"), el("dd", null, c.prefecture)),
        c.websiteUrl && el("div", { class: "wiz-review__row" }, el("dt", null, "WebサイトURL"), el("dd", null, c.websiteUrl)),
      )
    ),

    el("h3", { class: "wiz-h3" }, "ご同意事項"),
    el("label", { class: "wiz-consent" },
      el("input", { type: "checkbox", checked: consent.privacy ? true : null,
        onChange: (e) => { consent.privacy = e.target.checked; save(); render(); } }),
      el("span", null,
        "必須: ",
        el("a", { href: "/privacy.html", target: "_blank", rel: "noopener" }, "プライバシーポリシー"),
        " を確認し、相談への回答および必要な連絡のために入力情報が利用されることに同意します。"
      )
    ),
    state.errors.consent && el("p", { class: "wiz-error", role: "alert" }, state.errors.consent),
    el("label", { class: "wiz-consent" },
      el("input", { type: "checkbox", checked: consent.marketing ? true : null,
        onChange: (e) => { consent.marketing = e.target.checked; save(); } }),
      el("span", null, "任意: TUSGからサービスや新しい取り組みに関するご案内を受け取る")
    ),

    // ハニーポット
    el("div", { class: "wiz-honeypot", "aria-hidden": "true" },
      el("label", { for: "wiz-nickname" }, "この欄は空欄のままにしてください"),
      el("input", { id: "wiz-nickname", type: "text", tabindex: "-1", autocomplete: "off", value: "" })
    ),

    state.errors.submit && el("p", { class: "wiz-error", role: "alert" }, state.errors.submit),

    el("div", { class: "wiz-actions" },
      el("button", { type: "button", class: "btn btn--ghost", onClick: () => setStep("contact") }, "← 回答内容を修正する"),
      el("button", {
        type: "button", class: "btn btn--primary btn--lg",
        disabled: state.submitting ? true : null,
        onClick: () => submit()
      }, state.submitting ? "送信中…" : "この内容で相談を送信する →")
    )
  );
}

async function submit() {
  if (state.submitting) return;
  state.errors = {};

  // 必須同意
  if (!state.answers.consent.privacy) {
    state.errors.consent = "プライバシーポリシーへの同意が必要です";
    render(); return;
  }

  // 最低入力時間
  const startedAt = Number(sessionStorage.getItem(START_TIMESTAMP_KEY) || "0");
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_FORM_MS) {
    state.errors.submit = "送信できませんでした。もう少し時間をおいて再度お試しください。";
    render(); return;
  }

  // honeypot 検査 (DOM から取得)
  const hpEl = document.getElementById("wiz-nickname");
  if (hpEl && hpEl.value) {
    // 迷惑送信の疑い: 表向きは成功として、実際には送信しない
    setStep("complete");
    return;
  }

  state.submitting = true;
  render();

  const idempotencyKey = generateIdempotencyKey();
  const payload = {
    policy_version: POLICY_VERSION,
    primary_issue: state.answers.primary_issue,
    common: state.answers.common,
    branch: state.answers.branch,
    free_text: sanitizeFreeText(state.answers.free_text),
    result: state.result ? {
      category_key: state.result.category?.key,
      category_title: state.result.category?.title,
    } : null,
    contact: state.answers.contact,
    consent: state.answers.consent,
    started_at_ms: startedAt,
    elapsed_ms: elapsed,
  };

  try {
    const res = await fetch("/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      state.submitting = false;
      state.errors.submit = data.message || "送信に失敗しました。少し時間を置いてお試しください。";
      render(); return;
    }
    state.reference = data.reference || null;
    state.submitting = false;
    save();
    setStep("complete");
  } catch (e) {
    state.submitting = false;
    state.errors.submit = "通信エラーが発生しました。ネットワーク環境をご確認のうえ、再度お試しください。";
    render();
  }
}

// ---- STEP: 送信完了 ----
function renderComplete() {
  return el("section", { class: "wiz-card wiz-complete" },
    el("span", { class: "wiz-signature" }, "受付完了"),
    el("h2", { class: "wiz-h wiz-h--serif" }, "ご相談を受け付けました。"),
    state.reference && el("div", { class: "wiz-reference" },
      el("span", null, "受付番号"),
      el("strong", null, state.reference)
    ),
    el("p", { class: "wiz-lede" }, "ご登録のメールアドレスに自動返信メールをお送りしました。数分経ってもメールが届かない場合は、迷惑メールフォルダをご確認いただくか、下記窓口までご連絡ください。"),
    el("p", { class: "wiz-hint" }, "内容を確認後、担当者よりご連絡いたします。"),
    el("div", { class: "wiz-actions" },
      el("a", { href: "/", class: "btn btn--primary" }, "トップページへ戻る"),
      el("a", { href: "mailto:info@tusg.site", class: "btn btn--ghost" }, "追加のご連絡はこちら"),
    ),
    el("button", { type: "button", class: "wiz-textbtn", onClick: reset }, "新しく整理を始める")
  );
}

// ---- Render dispatcher ----
function render() {
  if (!root) return;
  root.innerHTML = "";
  const wrapper = el("div", { class: "wiz-shell" });
  const currentStepForProgress = {
    start: null, issue: "issue", common: "common",
    branch: "branch", result: "result", contact: "confirm",
    confirm: "confirm", complete: null
  }[state.step];
  if (currentStepForProgress) wrapper.appendChild(renderProgress(currentStepForProgress));
  const stepEl = ({
    start: renderStart,
    issue: renderIssue,
    common: renderCommon,
    branch: renderBranch,
    result: renderResult,
    contact: renderContact,
    confirm: renderConfirm,
    complete: renderComplete,
  })[state.step]();
  wrapper.appendChild(stepEl);
  root.appendChild(wrapper);
}

// 初回描画
render();
