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
  const pagesInput = document.getElementById("desired_pages");
  const errorBox = document.getElementById("error-box");
  const submitBtn = document.getElementById("submit-btn");
  const successBox = document.getElementById("success-box");
  const successId = document.getElementById("success-id");
  const form = document.getElementById("rq-form");

  serviceSlugInput.value = serviceSlugParam;
  sourceInput.value = sourceParam;

  // 全サービス取得後に保持 (HP 系の自動マッチ用)
  let allServices = [];
  // ページ数 → HP 系 slug マッピング
  function pickHpServiceByPages(pages) {
    const n = Number(pages);
    if (!Number.isFinite(n) || n < 1) return null;
    if (n === 1) return "hp-1p";
    if (n >= 2 && n <= 6) return "hp-2to6p";
    if (n >= 7) return "hp-7to12p"; // 13+ は最寄りの大きいプランに
    return null;
  }
  function isHpService(slug) {
    return typeof slug === "string" && slug.startsWith("hp-");
  }

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

  // 表示を特定の slug のサービスに切り替え
  function renderService(slug, badge = null) {
    const svc = allServices.find((s) => s.slug === slug);
    if (!svc) return false;
    serviceSlugInput.value = svc.slug;
    svcName.textContent = svc.name;
    svcDesc.textContent = svc.short_description || "";
    svcInfo.style.display = "block";
    // 既存のバッジがあれば消す
    const old = svcInfo.querySelector(".auto-switched");
    if (old) old.remove();
    if (badge) {
      const b = document.createElement("div");
      b.className = "auto-switched";
      b.style.cssText = "margin-top:8px;padding:6px 10px;background:#fff3cd;border:1px solid #ffe69c;border-radius:4px;font-size:0.8rem;color:#664d03;";
      b.textContent = badge;
      svcInfo.appendChild(b);
    }
    return true;
  }

  // サービス一覧を取得して初期サービスを表示
  async function loadServiceInfo() {
    try {
      const r = await fetch(`/api/pay-forward/services?_=${Date.now()}`, {
        credentials: "include", cache: "no-store",
      });
      const data = await r.json();
      if (!data.ok) return;
      allServices = data.services || [];
      if (!serviceSlugParam) return;
      const picked = renderService(serviceSlugParam);
      if (!picked) return;
      // HP 系サービスなら「希望ページ数」行を表示
      if (isHpService(serviceSlugParam)) pagesRow.style.display = "grid";
    } catch (e) {
      console.error("[request-quote] service info load failed:", e);
    }
  }
  loadServiceInfo();

  // 希望ページ数が変わったら、HP 系の場合は適切なサービスに自動切替
  pagesInput?.addEventListener("input", () => {
    const currentSlug = serviceSlugInput.value;
    if (!isHpService(currentSlug)) return;
    const targetSlug = pickHpServiceByPages(pagesInput.value);
    if (!targetSlug) return;
    if (targetSlug === currentSlug) {
      // 既に正しいプラン → バッジだけ消す
      const old = svcInfo.querySelector(".auto-switched");
      if (old) old.remove();
      return;
    }
    const target = allServices.find((s) => s.slug === targetSlug);
    if (!target) return;
    renderService(targetSlug, `ページ数 ${pagesInput.value} に合わせて「${target.name}」に切り替えました`);
  });

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
