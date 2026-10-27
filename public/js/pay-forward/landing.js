// Pay Forward LP (/pay-forward.html) のサービス一覧動的描画
(function () {
  const listEl = document.getElementById("pf-services-list");
  if (!listEl) return;

  function fmt(n) {
    return Number(n || 0).toLocaleString("ja-JP") + " 円";
  }

  function card(s) {
    const wrap = document.createElement("div");
    wrap.className = "pf-service-card";
    const applyUrl = s.service_type === "instant"
      ? `/pay-forward/apply?service=${encodeURIComponent(s.slug)}`
      : null;

    const title = document.createElement("h3");
    title.textContent = s.name;
    wrap.appendChild(title);

    if (s.short_description) {
      const desc = document.createElement("p");
      desc.textContent = s.short_description;
      wrap.appendChild(desc);
    }

    const price = document.createElement("div");
    price.className = "pf-service-card__price";
    if (s.min_amount != null) {
      const strong = document.createElement("strong");
      strong.textContent = fmt(s.min_amount);
      price.appendChild(document.createTextNode("最低料金 "));
      price.appendChild(strong);
      price.appendChild(document.createTextNode(" / 月 (税抜)"));
    } else {
      price.textContent = "お見積ベース";
    }
    wrap.appendChild(price);

    const actions = document.createElement("div");
    actions.className = "pf-service-card__actions";
    if (applyUrl) {
      const a = document.createElement("a");
      a.href = applyUrl;
      a.className = "btn btn--primary";
      a.textContent = "お申込み →";
      actions.appendChild(a);
    } else {
      const a = document.createElement("a");
      a.href = `/contact.html?inquiry=pay-forward&service=${encodeURIComponent(s.slug)}`;
      a.className = "btn btn--primary";
      a.textContent = "個別見積を依頼";
      actions.appendChild(a);
    }
    wrap.appendChild(actions);

    if (s.service_type === "quote_required") {
      const note = document.createElement("div");
      note.className = "pf-service-card__note";
      note.textContent = "※ このサービスは個別見積の発行後にお申込みいただけます。";
      wrap.appendChild(note);
    }

    return wrap;
  }

  async function load() {
    try {
      const r = await fetch(`/api/pay-forward/services?_=${Date.now()}`, {
        credentials: "include", cache: "no-store",
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      if (!data.ok) throw new Error(data.message || "load failed");
      const services = data.services || [];
      // 既存プレースホルダをクリア
      while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
      if (services.length === 0) {
        const ph = document.createElement("div");
        ph.className = "pf-service-card pf-service-card--placeholder";
        const h = document.createElement("h3");
        h.textContent = "サービス一覧は準備中です";
        ph.appendChild(h);
        const p = document.createElement("p");
        p.textContent = "Pay Forward の正式公開に向けて準備中です。公開までの間は以下の方法でご相談ください。";
        ph.appendChild(p);
        const act = document.createElement("div");
        act.className = "pf-service-card__actions";
        const a1 = document.createElement("a");
        a1.href = "/contact.html?inquiry=pay-forward";
        a1.className = "btn btn--primary";
        a1.textContent = "お問い合わせから相談する";
        act.appendChild(a1);
        const a2 = document.createElement("a");
        a2.href = "/hearing.html";
        a2.className = "btn btn--ghost";
        a2.textContent = "30秒無料診断を試す";
        act.appendChild(a2);
        ph.appendChild(act);
        listEl.appendChild(ph);
        return;
      }
      for (const s of services) listEl.appendChild(card(s));
    } catch (e) {
      // 失敗時はプレースホルダのまま
      console.error("[pay-forward LP] services fetch failed:", e);
    }
  }

  load();
})();
