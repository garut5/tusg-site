// 合同会社TUSG コーポレートサイト 共通スクリプト (v4 - cinematic motion)

(function () {
  // Prevent flash before hydration
  document.documentElement.classList.add("js-loading");

  document.addEventListener("DOMContentLoaded", function () {
    initMobileMenu();
    markCurrentNav();
    initStickyCTA();
    initSplitText();
    initReveal();
    initParallax();
    initHeaderShrink();
    initScrollProgress();
    initMagneticButtons();
    initPageEnter();

    requestAnimationFrame(function () {
      document.documentElement.classList.remove("js-loading");
      document.body.classList.add("ready");
    });
  });

  // ---------- Mobile menu ----------
  function initMobileMenu() {
    const btn = document.querySelector(".menu-btn");
    const nav = document.querySelector(".mobile-nav");
    if (!btn || !nav) return;

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

  // ---------- Split text (word-level stagger reveal) ----------
  function initSplitText() {
    const targets = document.querySelectorAll("[data-split]");
    targets.forEach(function (el) {
      if (el.dataset.splitDone === "true") return;
      // Preserve <br> and inline elements; wrap words in spans
      const nodes = Array.from(el.childNodes);
      let idx = 0;
      const frag = document.createDocumentFragment();
      nodes.forEach(function (node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parts = node.textContent.split(/(\s+)/);
          parts.forEach(function (part) {
            if (!part.length) return;
            if (/^\s+$/.test(part)) {
              frag.appendChild(document.createTextNode(part));
              return;
            }
            // For Japanese: treat each character as its own animatable unit for smoother stagger
            // but keep punctuation attached.
            const chunks = splitJp(part);
            chunks.forEach(function (chunk) {
              const wrap = document.createElement("span");
              wrap.className = "split-word";
              const inner = document.createElement("span");
              inner.textContent = chunk;
              inner.style.setProperty("--i", idx);
              wrap.appendChild(inner);
              frag.appendChild(wrap);
              idx++;
            });
          });
        } else {
          frag.appendChild(node.cloneNode(true));
        }
      });
      el.innerHTML = "";
      el.appendChild(frag);
      el.dataset.splitDone = "true";
    });
  }

  function splitJp(text) {
    // Group consecutive kana/kanji into 2-char chunks, latin into single words, keep punctuation
    const chunks = [];
    let buf = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const isJp = /[぀-ヿ㐀-鿿＀-￯]/.test(c);
      if (isJp) {
        buf += c;
        if (buf.length >= 2) { chunks.push(buf); buf = ""; }
      } else {
        if (buf.length) { chunks.push(buf); buf = ""; }
        chunks.push(c);
      }
    }
    if (buf.length) chunks.push(buf);
    return chunks;
  }

  // ---------- Reveal (IntersectionObserver, with re-observe for stagger children) ----------
  function initReveal() {
    const els = document.querySelectorAll("[data-reveal], [data-split], [data-mask], [data-stagger]");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
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
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    els.forEach(function (el) { io.observe(el); });
  }

  // ---------- Parallax ----------
  function initParallax() {
    const items = document.querySelectorAll("[data-parallax]");
    if (!items.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ticking = false;

    function update() {
      const wh = window.innerHeight;
      items.forEach(function (el) {
        const rect = el.getBoundingClientRect();
        const speed = parseFloat(el.getAttribute("data-parallax")) || 0.15;
        const center = rect.top + rect.height / 2 - wh / 2;
        const offset = center * -speed;
        // Use CSS `translate` property so it composes with existing transform (e.g. ken-burns scale)
        el.style.translate = "0 " + offset.toFixed(1) + "px";
      });
      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();
  }

  // ---------- Header shrink ----------
  function initHeaderShrink() {
    let ticking = false;
    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(function () {
          document.body.classList.toggle("scrolled", window.scrollY > 32);
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // ---------- Scroll progress bar ----------
  function initScrollProgress() {
    const wrap = document.createElement("div");
    wrap.className = "scroll-progress";
    const bar = document.createElement("div");
    bar.className = "scroll-progress__bar";
    wrap.appendChild(bar);
    document.body.appendChild(wrap);

    let ticking = false;
    function update() {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const p = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
      bar.style.transform = "scaleX(" + p.toFixed(3) + ")";
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  // ---------- Magnetic hover on buttons (mouse position glow) ----------
  function initMagneticButtons() {
    if (!window.matchMedia("(hover: hover)").matches) return;
    document.querySelectorAll(".btn").forEach(function (btn) {
      btn.addEventListener("mousemove", function (e) {
        const r = btn.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100;
        const y = ((e.clientY - r.top) / r.height) * 100;
        btn.style.setProperty("--mx", x + "%");
        btn.style.setProperty("--my", y + "%");
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.removeProperty("--mx");
        btn.style.removeProperty("--my");
      });
    });
  }

  // ---------- Page enter curtain ----------
  function initPageEnter() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (document.querySelector(".page-curtain")) return;
    const curtain = document.createElement("div");
    curtain.className = "page-curtain";
    document.body.appendChild(curtain);
    // Auto-remove after animation to avoid layering
    setTimeout(function () {
      if (curtain.parentNode) curtain.parentNode.removeChild(curtain);
    }, 1600);
  }
})();
