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
    btn.addEventListener("click", function () {
      const open = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", String(!open));
      btn.setAttribute("aria-expanded", String(!open));
      document.body.style.overflow = !open ? "hidden" : "";
    });
    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.setAttribute("data-open", "false");
        btn.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      });
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
