// 合同会社TUSG コーポレートサイト 共通スクリプト
// - モバイルメニュー開閉
// - 自ページ内アンカーへのスムーズスクロール
//
// フォーム送信は Cloudflare Pages Function (/contact.php) に
// ネイティブの form POST で渡し、サーバ側で thanks.html へリダイレクト。

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    initMobileMenu();
    markCurrentNav();
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
})();
