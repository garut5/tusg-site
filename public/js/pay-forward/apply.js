(function () {
  const url = new URL(location.href);
  const quoteId = url.searchParams.get("quote");
  const quoteToken = url.searchParams.get("token");
  const isQuoteMode = Boolean(quoteId && quoteToken);
  const preselect = url.searchParams.get("service");

  const quoteBanner = document.getElementById("quote-banner");
  const serviceSel = document.getElementById("service");
  const serviceDesc = document.getElementById("service-desc");
  const minBox = document.getElementById("min-amount-box");
  const minEl = document.getElementById("min-amount");
  const recEl = document.getElementById("recommended-amount");
  const amountInput = document.getElementById("amount");
  const emailInput = document.getElementById("email");
  const nameInput = document.getElementById("name");
  const companyInput = document.getElementById("company");
  const promoInput = document.getElementById("promo");
  const errorBox = document.getElementById("error-box");
  const submitBtn = document.getElementById("submit-btn");

  let services = [];
  let currentQuote = null;

  function fmt(n) { return Number(n || 0).toLocaleString("ja-JP") + " 円"; }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = "block";
    submitBtn.disabled = false;
    submitBtn.textContent = "Stripe で決済ページに進む";
  }
  function clearError() {
    errorBox.style.display = "none";
    errorBox.textContent = "";
  }

  function renderMinBox(service, minAmount) {
    serviceDesc.textContent = service?.short_description || "";
    if (minAmount) {
      minEl.textContent = fmt(minAmount);
      amountInput.min = minAmount;
      amountInput.placeholder = `例: ${minAmount}`;
      recEl.textContent = "";
      minBox.style.display = "block";
    } else {
      minBox.style.display = "none";
    }
  }

  function updateMinDisplay() {
    const slug = serviceSel.value;
    const svc = services.find((s) => s.slug === slug);
    renderMinBox(svc, svc?.min_amount ?? svc?.default_min_amount ?? null);
  }

  // --- Quote モード: 送付された URL でアクセス ---
  async function loadQuoteMode() {
    if (quoteBanner) quoteBanner.style.display = "block";
    serviceSel.innerHTML = '<option value="">読み込み中…</option>';
    try {
      const r = await fetch(
        `/api/pay-forward/quote?id=${encodeURIComponent(quoteId)}&token=${encodeURIComponent(quoteToken)}&_=${Date.now()}`,
        { credentials: "include", cache: "no-store" }
      );
      const data = await r.json();
      if (!r.ok || !data.ok) {
        const msg = data?.message || `HTTP ${r.status}`;
        showError(`見積リンクが無効です: ${msg}`);
        serviceSel.innerHTML = `<option value="">エラー: ${msg}</option>`;
        submitBtn.disabled = true;
        return;
      }
      currentQuote = data.quote;
      // ドロップダウンはこの 1 サービスのみ・固定
      serviceSel.innerHTML = `<option value="${data.service.slug}">${data.service.name}</option>`;
      serviceSel.value = data.service.slug;
      serviceSel.disabled = true;
      renderMinBox(data.service, data.quote.min_amount);
      // email を quote に合わせて事前入力・編集不可
      if (data.quote.customer_email) {
        emailInput.value = data.quote.customer_email;
        emailInput.readOnly = true;
      }
      if (data.quote.customer_name && !nameInput.value) nameInput.value = data.quote.customer_name;
      if (data.quote.customer_company && !companyInput.value) companyInput.value = data.quote.customer_company;

      // バナーに有効期限と範囲を追加
      if (quoteBanner && data.quote.scope_description) {
        const extra = document.createElement("div");
        extra.style.marginTop = "8px";
        extra.style.fontSize = "0.85em";
        extra.textContent = "見積範囲: " + data.quote.scope_description;
        quoteBanner.appendChild(extra);
      }
    } catch (e) {
      console.error("[pay-forward] quote load failed:", e);
      serviceSel.innerHTML = `<option value="">読み込み失敗</option>`;
      showError(`見積情報の取得に失敗しました: ${e.message}`);
    }
  }

  // --- 通常モード: instant サービスのみを表示 ---
  async function loadInstantServices() {
    serviceSel.innerHTML = '<option value="">読み込み中…</option>';
    try {
      const r = await fetch(`/api/pay-forward/services?_=${Date.now()}`, {
        credentials: "include", cache: "no-store",
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`API ${r.status}: ${txt.slice(0, 200) || r.statusText}`);
      }
      const data = await r.json();
      if (!data.ok) throw new Error(data.message || "読み込みに失敗しました");
      // ★ apply ページでは instant サービスのみ選択可能にする
      services = (data.services || []).filter((s) => s.service_type === "instant");
      if (services.length === 0) {
        serviceSel.innerHTML = '<option value="">お申込み可能なサービスはまだありません</option>';
        submitBtn.disabled = true;
        return;
      }
      if (services.length === 1) {
        // 1 件しかない場合は自動選択・ドロップダウン無効化
        const only = services[0];
        serviceSel.innerHTML = `<option value="${only.slug}">${only.name}</option>`;
        serviceSel.value = only.slug;
        serviceSel.disabled = true;
        updateMinDisplay();
        return;
      }
      // 複数ある場合はドロップダウン表示
      serviceSel.innerHTML = '<option value="">選択してください</option>' +
        services.map((s) => `<option value="${s.slug}">${s.name}</option>`).join("");
      serviceSel.addEventListener("change", updateMinDisplay);
      // ?service=slug で指定された場合は自動選択
      if (preselect && services.some((s) => s.slug === preselect)) {
        serviceSel.value = preselect;
        updateMinDisplay();
      }
    } catch (e) {
      console.error("[pay-forward] loadInstantServices failed:", e);
      serviceSel.innerHTML = `<option value="">読み込み失敗</option>`;
      submitBtn.disabled = true;
      showError(`サービス読み込みエラー: ${e.message}`);
    }
  }

  if (isQuoteMode) loadQuoteMode(); else loadInstantServices();

  // --- 送信 ---
  document.getElementById("apply-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    clearError();
    submitBtn.disabled = true;
    submitBtn.textContent = "処理中…";

    const payload = {
      service_slug: serviceSel.value,
      amount: Number(amountInput.value),
      customer_email: emailInput.value.trim(),
      customer_name: nameInput.value.trim(),
      customer_company: companyInput.value.trim(),
      promotion_code: promoInput.value.trim(),
    };
    if (isQuoteMode && currentQuote) {
      payload.quote_id = currentQuote.id;
      payload.quote_token = quoteToken;
    }

    try {
      const r = await fetch("/api/pay-forward/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
        cache: "no-store",
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.message || `HTTP ${r.status}`);
      location.href = data.checkout_url;
    } catch (e) {
      showError(e.message);
    }
  });
})();
