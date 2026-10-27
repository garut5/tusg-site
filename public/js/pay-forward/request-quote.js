(function () {
  const url = new URL(location.href);
  const serviceSlugParam = url.searchParams.get("service") || "";
  const sourceParam = url.searchParams.get("source") || "lp";

  const serviceSlugInput = document.getElementById("service_slug");
  const sourceInput = document.getElementById("source");
  const svcInfo = document.getElementById("svc-info");
  const svcName = document.getElementById("svc-name");
  const svcDesc = document.getElementById("svc-desc");
  const pagesRow = document.getElementById("pages-row");
  const errorBox = document.getElementById("error-box");
  const submitBtn = document.getElementById("submit-btn");
  const successBox = document.getElementById("success-box");
  const successId = document.getElementById("success-id");
  const form = document.getElementById("rq-form");

  serviceSlugInput.value = serviceSlugParam;
  sourceInput.value = sourceParam;

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = "block";
    submitBtn.disabled = false;
    submitBtn.textContent = "見積を依頼する";
  }
  function clearError() {
    errorBox.style.display = "none";
    errorBox.textContent = "";
  }

  // サービス情報を取得して表示
  async function loadServiceInfo() {
    if (!serviceSlugParam) return;
    try {
      const r = await fetch(`/api/pay-forward/services?_=${Date.now()}`, {
        credentials: "include", cache: "no-store",
      });
      const data = await r.json();
      if (!data.ok) return;
      const svc = (data.services || []).find((s) => s.slug === serviceSlugParam);
      if (svc) {
        svcInfo.style.display = "block";
        svcName.textContent = svc.name;
        svcDesc.textContent = svc.short_description || "";
        // HP 系サービスなら「希望ページ数」行を表示
        if (/^hp-/.test(svc.slug)) pagesRow.style.display = "grid";
      }
    } catch (e) {
      console.error("[request-quote] service info load failed:", e);
    }
  }
  loadServiceInfo();

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    clearError();
    submitBtn.disabled = true;
    submitBtn.textContent = "送信中…";

    const payload = {
      service_slug: serviceSlugInput.value || "",
      source: sourceInput.value || "lp",
      customer_name: document.getElementById("customer_name").value.trim(),
      customer_email: document.getElementById("customer_email").value.trim(),
      customer_company: document.getElementById("customer_company").value.trim(),
      customer_phone: document.getElementById("customer_phone").value.trim(),
      desired_pages: document.getElementById("desired_pages").value || null,
      desired_deadline: document.getElementById("desired_deadline").value.trim(),
      budget_feel: document.getElementById("budget_feel").value,
      requirements: document.getElementById("requirements").value.trim(),
      _gotcha: document.getElementById("_gotcha").value,
    };

    try {
      const r = await fetch("/api/pay-forward/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
        cache: "no-store",
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.message || `HTTP ${r.status}`);
      // 成功
      form.style.display = "none";
      svcInfo.style.display = "none";
      successBox.style.display = "block";
      successId.textContent = data.id || "(ID 不明)";
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      showError(`送信に失敗しました: ${e.message}`);
    }
  });
})();
