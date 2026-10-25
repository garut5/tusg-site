(function () {
  const url = new URL(location.href);
  const quoteId = url.searchParams.get("quote");
  const quoteToken = url.searchParams.get("token");
  const isQuoteMode = Boolean(quoteId && quoteToken);
  if (isQuoteMode) {
    const banner = document.getElementById("quote-banner");
    if (banner) banner.style.display = "block";
  }

  const serviceSel = document.getElementById("service");
  const serviceDesc = document.getElementById("service-desc");
  const minBox = document.getElementById("min-amount-box");
  const minEl = document.getElementById("min-amount");
  const recEl = document.getElementById("recommended-amount");
  const amountInput = document.getElementById("amount");
  const errorBox = document.getElementById("error-box");
  const submitBtn = document.getElementById("submit-btn");

  let services = [];

  function fmt(n) {
    return Number(n || 0).toLocaleString("ja-JP") + " 円";
  }

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

  function updateMinDisplay() {
    const slug = serviceSel.value;
    const svc = services.find((s) => s.slug === slug);
    if (!svc) {
      minBox.style.display = "none";
      serviceDesc.textContent = "";
      amountInput.min = 100;
      return;
    }
    serviceDesc.textContent = svc.short_description || "";
    const minAmount = svc.min_amount != null ? svc.min_amount : (svc.default_min_amount || null);
    if (minAmount) {
      minEl.textContent = fmt(minAmount);
      amountInput.min = minAmount;
      amountInput.placeholder = `例: ${minAmount}`;
      if (svc.recommended_amount) {
        recEl.textContent = `推奨: ${fmt(svc.recommended_amount)}`;
      } else {
        recEl.textContent = "";
      }
      minBox.style.display = "block";
    } else {
      minBox.style.display = "none";
    }
  }

  async function loadServices() {
    serviceSel.innerHTML = '<option value="">読み込み中…</option>';
    try {
      const url = `/api/pay-forward/services?_=${Date.now()}`;
      console.log("[pay-forward] fetching", url);
      const r = await fetch(url, { credentials: "include", cache: "no-store" });
      console.log("[pay-forward] response", r.status, r.statusText);
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`API ${r.status}: ${txt.slice(0, 200) || r.statusText}`);
      }
      const data = await r.json();
      console.log("[pay-forward] data", data);
      if (!data.ok) throw new Error(data.message || "読み込みに失敗しました");
      services = data.services || [];
      if (services.length === 0) {
        serviceSel.innerHTML = '<option value="">公開中のサービスはまだありません</option>';
        submitBtn.disabled = true;
        return;
      }
      serviceSel.innerHTML = '<option value="">選択してください</option>' +
        services.map((s) => `<option value="${s.slug}">${s.name}</option>`).join("");
      serviceSel.addEventListener("change", updateMinDisplay);
    } catch (e) {
      console.error("[pay-forward] loadServices failed:", e);
      serviceSel.innerHTML = `<option value="">エラー: 読み込み失敗</option>`;
      submitBtn.disabled = true;
      showError(`サービス読み込みエラー: ${e.message} / F12で詳細確認`);
    }
  }

  loadServices();

  document.getElementById("apply-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    clearError();
    submitBtn.disabled = true;
    submitBtn.textContent = "処理中…";

    const payload = {
      service_slug: serviceSel.value,
      amount: Number(amountInput.value),
      customer_email: document.getElementById("email").value.trim(),
      customer_name: document.getElementById("name").value.trim(),
      customer_company: document.getElementById("company").value.trim(),
      promotion_code: document.getElementById("promo").value.trim(),
    };
    if (isQuoteMode) {
      payload.quote_id = quoteId;
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
      if (!data.ok) {
        throw new Error(data.message || `HTTP ${r.status}`);
      }
      location.href = data.checkout_url;
    } catch (e) {
      showError(e.message);
    }
  });
})();
