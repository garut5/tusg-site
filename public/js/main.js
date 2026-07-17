// 合同会社TUSG コーポレートサイト 共通スクリプト
// - モバイルメニュー
// - 現在ページのナビハイライト
// - Sticky CTA 用の body class 付与 (Sticky CTAがある時のみ)
// - スクロールリビール (IntersectionObserver で data-reveal に is-visible)

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    initMobileMenu();
    markCurrentNav();
    initStickyCTA();
    initReveal();
  });

  function initMobileMenu() {
    const btn = document.querySelector(".menu-btn");
    const nav = document.querySelector(".mobile-nav");
    if (!btn || !nav) return;

    // 背景暗幕を差し込む (無ければ)
    let backdrop = document.querySelector(".mobile-nav-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "mobile-nav-backdrop";
      document.body.appendChild(backdrop);
    }

    function setOpen(open) {
      nav.setAttribute("data-open", String(open));
      btn.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("nav-open", open);
      document.body.style.overflow = open ? "hidden" : "";
    }

    btn.addEventListener("click", function () {
      const open = nav.getAttribute("data-open") === "true";
      setOpen(!open);
    });
    backdrop.addEventListener("click", function () { setOpen(false); });
    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { setOpen(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });
  }

  function markCurrentNav() {
    const path = location.pathname.replace(/index\.html?$/, "") || "/";
    document.querySelectorAll(".site-nav a, .mobile-nav a").forEach(function (a) {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http")) return;
      const normalized = href.replace(/index\.html?$/, "") || "/";
      if (normalized === path) a.setAttribute("aria-current", "page");
    });
  }

  function initStickyCTA() {
    if (document.querySelector(".sticky-cta")) {
      document.body.classList.add("has-sticky");
    }
  }

  function initReveal() {
    const els = document.querySelectorAll("[data-reveal]");
    if (!els.length || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -80px 0px", threshold: 0.05 });
    els.forEach(function (el) { io.observe(el); });
  }
})();
