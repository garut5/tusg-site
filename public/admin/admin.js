// TUSG Pay Forward 管理画面 — SPA 的に動く単一 JS
// 認証は Cloudflare Access 側で担保される前提
// (ブラウザがここまで到達した時点で既に認証済み)

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return e;
  };
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const yen = (n) => `¥${fmt(Math.round(n))}`;
  const fmtDate = (ms) => new Date(ms).toLocaleString("ja-JP");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function toast(msg, kind = "") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "adm-toast" + (kind ? " adm-toast--" + kind : "");
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 4000);
  }

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    let data = {};
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  }

  // -------------------- Tabs --------------------
  function switchTab(name) {
    $$(".adm-tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
    $$(".adm-tabs button").forEach((b) =>
      b.setAttribute("aria-selected", b.dataset.tab === name ? "true" : "false")
    );
    if (name === "services") loadServices();
    if (name === "assumptions") loadAssumptions();
    if (name === "pricing") loadPricingSetup();
    if (name === "quotes") loadQuotes();
    if (name === "subscriptions") loadSubscriptions();
    if (name === "customers") loadCustomers();
  }
  $$(".adm-tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  // -------------------- Dashboard --------------------
  let serverStatus = null;
  async function loadStatus() {
    const { ok, status, data } = await api("/api/admin/me");
    const meta = $("#hdrMeta");
    const grid = $("#statusCards");
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    if (!ok) {
      meta.textContent = `[${status}] ` + (data.message || "unauthorized");
      grid.appendChild(adminGuidance(data));
      return;
    }
    serverStatus = data;
    meta.textContent = `${data.admin.email} / ${new Date(data.server_time).toLocaleString("ja-JP")}`;
    const items = [
      ["D1 (TUSG_DB)", data.status.d1_bound, "wrangler d1 create tusg-main を実行し wrangler.toml に反映"],
      ["Stripe Secret", data.status.stripe_secret_set, "TUSG_STRIPE_SECRET_KEY を Pages secret に登録"],
      ["Stripe Webhook Secret", data.status.stripe_webhook_set, "TUSG_STRIPE_WEBHOOK_SECRET を Pages secret に登録"],
      ["Pay Forward 公開", data.status.pay_forward_enabled, "wrangler.toml の PAY_FORWARD_ENABLED=\"true\" にして deploy"],
      ["Resend API Key", data.status.resend_api_key_set, "RESEND_API_KEY を Pages secret に登録"],
    ];
    for (const [label, ok, hint] of items) {
      grid.appendChild(el("div", { class: "adm-status" },
        el("div", { class: "adm-status__k" }, label),
        el("div", { class: ok ? "adm-status__v adm-status__v--ok" : "adm-status__v adm-status__v--ng" },
          ok ? "✓ 設定済" : "✗ 未設定"),
        !ok ? el("div", { class: "small muted" }, hint) : null
      ));
    }
    if (!data.status.d1_bound) grid.appendChild(adminGuidance(data));
  }
  function adminGuidance(data) {
    const g = el("div", { class: "adm-guidance" });
    g.innerHTML = `
      <h3>D1 データベースを作成してください</h3>
      <p>以下のコマンドを順に実行してください。コマンドが使えない場合は Cloudflare Dashboard の
         Workers &amp; Pages → D1 からも作成できます。</p>
      <pre>wrangler d1 create tusg-main
# 返却された database_id を wrangler.toml の [[d1_databases]] の database_id に貼る
# コメントアウトを外す

wrangler d1 execute tusg-main --remote --file=migrations/pay-forward/0001_init.sql
wrangler d1 execute tusg-main --remote --file=migrations/pay-forward/0002_seed_assumptions.sql
wrangler d1 execute tusg-main --remote --file=migrations/pay-forward/0003_seed_services.sql

# 再 deploy
npx wrangler pages deploy public --project-name=tusg-site --branch=main</pre>
      <p>管理者 allowlist は Cloudflare Dashboard → Pages → tusg-site → Settings → Environment variables で
         <code>ADMIN_ALLOWED_EMAILS</code> に対象 email をカンマ区切りで設定してください。</p>
    `;
    return g;
  }

  // -------------------- Services --------------------
  let servicesCache = [];
  async function loadServices() {
    const list = $("#servicesList");
    list.textContent = "loading…";
    const { ok, data } = await api("/api/admin/services");
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!ok) { list.appendChild(adminGuidance(data)); return; }
    servicesCache = data.services || [];
    if (servicesCache.length === 0) {
      list.appendChild(el("div", { class: "adm-card muted" }, "まだサービスが登録されていません"));
      return;
    }
    for (const s of servicesCache) list.appendChild(renderServiceRow(s));
  }

  function renderServiceRow(s) {
    const typeBadge = s.service_type === "instant"
      ? el("span", { class: "adm-badge" }, "instant")
      : el("span", { class: "adm-badge adm-badge--warn" }, "quote_required");
    const pubBadge = s.is_published
      ? el("span", { class: "adm-badge" }, "公開中")
      : el("span", { class: "adm-badge adm-badge--muted" }, "非公開");

    return el("div", { class: "adm-list__item" },
      el("div", {},
        el("div", {}, el("strong", {}, s.name),
          " ", typeBadge, " ", pubBadge),
        el("div", { class: "adm-list__item__meta" },
          `slug: ${s.slug}` +
          (s.default_min_amount ? ` / 暫定最低 ${yen(s.default_min_amount)}` : "") +
          (s.recommended_amount ? ` / 推奨 ${yen(s.recommended_amount)}` : "")
        )
      ),
      el("div", {},
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => openServiceModal(s) }, "編集"),
        " ",
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => openCostsModal(s) }, "原価"),
        " ",
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => deleteService(s) }, "削除"),
      )
    );
  }

  function openServiceModal(s = null) {
    $("#serviceModalTitle").textContent = s ? `サービス編集: ${s.name}` : "新規サービス";
    $("#svc_id").value = s?.id ?? "";
    $("#svc_slug").value = s?.slug ?? "";
    $("#svc_slug").disabled = Boolean(s);
    $("#svc_name").value = s?.name ?? "";
    $("#svc_service_type").value = s?.service_type ?? "instant";
    $("#svc_service_type").disabled = Boolean(s);
    $("#svc_short_description").value = s?.short_description ?? "";
    $("#svc_long_description").value = s?.long_description ?? "";
    $("#svc_recommended_amount").value = s?.recommended_amount ?? "";
    $("#svc_default_min_amount").value = s?.default_min_amount ?? "";
    $("#svc_is_published").checked = Boolean(s?.is_published);
    $("#serviceModal").showModal();
  }
  $("#btnNewService").addEventListener("click", () => openServiceModal());
  $("#svcCancel").addEventListener("click", () => $("#serviceModal").close());
  $("#serviceForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = $("#svc_id").value;
    const payload = {
      slug: $("#svc_slug").value,
      name: $("#svc_name").value,
      service_type: $("#svc_service_type").value,
      short_description: $("#svc_short_description").value,
      long_description: $("#svc_long_description").value,
      recommended_amount: $("#svc_recommended_amount").value || null,
      default_min_amount: $("#svc_default_min_amount").value || null,
      is_published: $("#svc_is_published").checked,
    };
    const res = id
      ? await api(`/api/admin/services?id=${id}`, { method: "PATCH", body: payload })
      : await api("/api/admin/services", { method: "POST", body: payload });
    if (res.ok) {
      toast("保存しました", "ok");
      $("#serviceModal").close();
      loadServices();
    } else {
      toast(res.data.message || "保存失敗", "err");
    }
  });
  async function deleteService(s) {
    if (!confirm(`"${s.name}" を削除します。契約がある場合は非公開化を推奨。削除しますか？`)) return;
    const res = await api(`/api/admin/services?id=${s.id}`, { method: "DELETE" });
    if (res.ok) { toast("削除しました", "ok"); loadServices(); }
    else toast(res.data.message || "削除失敗", "err");
  }

  // -------------------- Costs --------------------
  async function openCostsModal(service) {
    $("#costsTitle").textContent = service.name;
    $("#cost_service_id").value = service.id;
    const list = $("#costsList");
    list.textContent = "loading…";
    const res = await api(`/api/admin/services?id=${service.id}&with=costs`);
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!res.ok) { list.appendChild(el("div", { class: "muted" }, res.data.message)); }
    else {
      const costs = res.data.costs || [];
      if (costs.length === 0) list.appendChild(el("div", { class: "muted" }, "原価項目なし"));
      else {
        const tbl = el("table", { class: "adm-pricing-breakdown" });
        tbl.appendChild(el("thead", {}, el("tr", {},
          el("th", {}, "分類"), el("th", {}, "項目"),
          el("th", {}, "工数"), el("th", {}, "金額"), el("th", {}, "単位"), el("th", {}, "")
        )));
        const tb = el("tbody");
        for (const c of costs) {
          tb.appendChild(el("tr", {},
            el("td", {}, c.cost_category),
            el("td", {}, c.item_name),
            el("td", {}, c.hours ?? "-"),
            el("td", {}, c.amount ? yen(c.amount) : "-"),
            el("td", {}, c.unit || "-"),
            el("td", {}, el("button", {
              class: "btn btn--ghost btn--sm",
              onClick: async () => {
                if (!confirm("削除しますか？")) return;
                const r = await api(`/api/admin/services?cost_id=${c.id}`, { method: "DELETE" });
                if (r.ok) openCostsModal(service);
                else toast(r.data.message, "err");
              },
            }, "削除"))
          ));
        }
        tbl.appendChild(tb);
        list.appendChild(tbl);
      }
    }
    $("#costsModal").showModal();
  }
  $("#costsClose").addEventListener("click", () => $("#costsModal").close());
  $("#costForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const serviceId = $("#cost_service_id").value;
    const body = {
      cost_category: $("#cost_category").value,
      item_name: $("#cost_item_name").value,
      hours: $("#cost_hours").value ? Number($("#cost_hours").value) : null,
      amount: $("#cost_amount").value ? Number($("#cost_amount").value) : null,
      unit: $("#cost_unit").value || null,
      source: $("#cost_source").value,
    };
    const res = await api(`/api/admin/services?id=${serviceId}&op=add_cost`, { method: "POST", body });
    if (res.ok) {
      toast("追加しました", "ok");
      $("#cost_item_name").value = "";
      $("#cost_hours").value = "";
      $("#cost_amount").value = "";
      $("#cost_source").value = "";
      // 一覧再読込
      const svc = servicesCache.find((s) => String(s.id) === String(serviceId));
      if (svc) openCostsModal(svc);
    } else {
      toast(res.data.message || "追加失敗", "err");
    }
  });

  // -------------------- Assumptions --------------------
  async function loadAssumptions() {
    const form = $("#assumptionsForm");
    const res = await api("/api/admin/assumptions");
    if (!res.ok) {
      form.insertAdjacentElement("beforebegin", adminGuidance(res.data));
      return;
    }
    const a = res.data.assumptions || {};
    for (const [key, obj] of Object.entries(a)) {
      const input = form.querySelector(`[name="${key}"]`);
      if (input && obj?.value != null) input.value = obj.value;
    }
  }
  $("#assumptionsForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const updates = [];
    for (const [key, value] of fd.entries()) {
      if (value !== "") updates.push({ key, value: String(value) });
    }
    const res = await api("/api/admin/assumptions", { method: "PUT", body: { updates } });
    if (res.ok) {
      toast("保存しました", "ok");
      $("#assumptionsStatus").textContent = `${res.data.applied.length} 項目更新`;
    } else {
      toast(res.data.message || "保存失敗", "err");
    }
  });

  // -------------------- Pricing --------------------
  async function loadPricingSetup() {
    const sel = $("#pricingServiceSelect");
    sel.innerHTML = '<option value="">loading…</option>';
    const res = await api("/api/admin/services");
    if (!res.ok) {
      $("#pricingPreview").innerHTML = "";
      $("#pricingPreview").appendChild(adminGuidance(res.data));
      return;
    }
    const services = res.data.services || [];
    sel.innerHTML = '<option value="">— 選択してください —</option>';
    for (const s of services) {
      const o = document.createElement("option");
      o.value = s.id; o.textContent = `${s.name} (${s.slug})`;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      const id = sel.value;
      $("#btnPricingCalc").disabled = !id;
      $("#btnPricingPublish").disabled = true;
      $("#pricingPreview").textContent = id ? "「計算する」で現在の原価から最低料金を算出" : "サービスを選択してください";
      if (id) loadPricingHistory(id);
    };
  }
  async function loadPricingHistory(serviceId) {
    const el2 = $("#pricingHistory");
    el2.textContent = "loading…";
    const res = await api(`/api/admin/pricing?service_id=${serviceId}`);
    if (!res.ok) { el2.textContent = res.data.message; return; }
    const h = res.data.history || [];
    if (h.length === 0) { el2.textContent = "まだ公開履歴なし"; return; }
    el2.innerHTML = "";
    const tbl = el("table", { class: "adm-pricing-breakdown" });
    tbl.appendChild(el("thead", {}, el("tr", {},
      el("th", {}, "公開日"), el("th", {}, "最低料金"), el("th", {}, "終了日"), el("th", {}, "公開者")
    )));
    const tb = el("tbody");
    for (const r of h) tb.appendChild(el("tr", {},
      el("td", {}, fmtDate(r.effective_from)),
      el("td", {}, yen(r.min_amount)),
      el("td", {}, r.effective_to ? fmtDate(r.effective_to) : "（現行）"),
      el("td", {}, r.created_by || "-"),
    ));
    tbl.appendChild(tb);
    el2.appendChild(tbl);
  }
  let lastCalcBreakdown = null;
  let lastCalcServiceId = null;
  $("#btnPricingCalc").addEventListener("click", async () => {
    const id = $("#pricingServiceSelect").value;
    if (!id) return;
    const res = await api(`/api/admin/pricing/calculate?service_id=${id}`, { method: "POST" });
    const prev = $("#pricingPreview");
    if (!res.ok) { prev.textContent = res.data.message; return; }
    lastCalcBreakdown = res.data.breakdown;
    lastCalcServiceId = id;
    prev.innerHTML = "";
    prev.appendChild(renderBreakdown(res.data.breakdown, res.data.assumptions));
    $("#btnPricingPublish").disabled = false;
  });
  function renderBreakdown(b, a) {
    const wrap = el("div", { class: "adm-pricing-breakdown" });
    const tbl = el("table");
    tbl.appendChild(el("thead", {}, el("tr", {},
      el("th", {}, "項目"), el("th", {}, "金額 (月)")
    )));
    const tb = el("tbody");
    const row = (k, v) => tb.appendChild(el("tr", {}, el("td", {}, k), el("td", {}, typeof v === "number" ? yen(v) : v)));
    row("初期費用 (合計)", b.initial_total);
    row(`→ 月按分 (÷ ${a.contract_amortization_months}ヶ月)`, b.initial_amortized_monthly);
    row("月次労務費", b.labor_monthly);
    row("月額固定インフラ (サービス固有)", b.infra_monthly_dedicated);
    row(`共通インフラ按分 (÷ ${a.expected_customers_year1}社)`, b.infra_shared_per_customer);
    row("変動費 (per_customer_month)", b.variable_per_customer);
    row("合計原価 (月/顧客)", b.base_cost_per_customer_month);
    row(`× (1 + 粗利目標 ${(a.profit_margin*100).toFixed(0)}%)`, b.with_margin);
    row(`× (1 + バッファ ${(a.cost_buffer*100).toFixed(0)}%)`, b.with_buffer);
    row(`÷ (1 - 決済手数料 ${(b.payment_fee_rate*100).toFixed(2)}%)`, b.min_price_before_round);
    tbl.appendChild(tb);
    const foot = el("tfoot");
    foot.appendChild(el("tr", { class: "highlight" },
      el("td", {}, "最低月額 (税抜、¥100 単位切上げ)"),
      el("td", {}, yen(b.min_price_jpy))));
    tbl.appendChild(foot);
    wrap.appendChild(tbl);
    return wrap;
  }
  $("#btnPricingPublish").addEventListener("click", async () => {
    if (!lastCalcServiceId || !lastCalcBreakdown) return;
    if (!confirm(`最低料金 ${yen(lastCalcBreakdown.min_price_jpy)} で公開します。よろしいですか？`)) return;
    const res = await api(`/api/admin/pricing/publish?service_id=${lastCalcServiceId}`, { method: "POST" });
    if (res.ok) {
      toast(`公開しました (${yen(res.data.min_amount)})`, "ok");
      loadPricingHistory(lastCalcServiceId);
      $("#btnPricingPublish").disabled = true;
    } else {
      toast(res.data.message || "公開失敗", "err");
    }
  });

  // -------------------- Quotes --------------------
  async function loadQuotes() {
    const list = $("#quotesList");
    list.textContent = "loading…";
    const res = await api("/api/admin/quotes");
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!res.ok) { list.appendChild(adminGuidance(res.data)); return; }
    const quotes = res.data.quotes || [];
    if (quotes.length === 0) { list.appendChild(el("div", { class: "muted" }, "見積なし")); return; }
    for (const q of quotes) list.appendChild(renderQuoteRow(q));
  }
  function renderQuoteRow(q) {
    const statusBadge =
      q.status === "issued" ? el("span", { class: "adm-badge" }, "発行中")
      : q.status === "consumed" ? el("span", { class: "adm-badge adm-badge--muted" }, "使用済")
      : q.status === "revoked" ? el("span", { class: "adm-badge adm-badge--danger" }, "失効")
      : el("span", { class: "adm-badge adm-badge--warn" }, q.status);
    return el("div", { class: "adm-list__item" },
      el("div", {},
        el("div", {}, el("strong", {}, q.service_name || `service#${q.service_id}`), " → ",
          q.customer_email, " ", statusBadge),
        el("div", { class: "adm-list__item__meta" },
          `最低 ${yen(q.min_amount)}` +
          (q.recommended_amount ? ` / 推奨 ${yen(q.recommended_amount)}` : "") +
          ` / 期限 ${fmtDate(q.expires_at)} / 発行 ${q.issued_by || "-"}`
        )
      ),
      el("div", {},
        q.status === "issued" ? el("button", {
          class: "btn btn--ghost btn--sm",
          onClick: () => copyQuoteUrl(q),
        }, "URL コピー") : null,
        " ",
        q.status === "issued" ? el("button", {
          class: "btn btn--danger btn--sm",
          onClick: () => revokeQuote(q),
        }, "失効") : null,
      )
    );
  }
  function copyQuoteUrl(q) {
    const base = location.origin;
    const url = `${base}/pay-forward/apply?quote=${q.id}&token=${q.access_token}`;
    navigator.clipboard?.writeText(url)
      .then(() => toast("URL をコピーしました", "ok"))
      .catch(() => toast("クリップボードコピー失敗", "err"));
  }
  async function revokeQuote(q) {
    const reason = prompt("失効理由 (任意、残します)", "") || "";
    const res = await api(`/api/admin/quotes?id=${q.id}&op=revoke`, { method: "PATCH", body: { reason } });
    if (res.ok) { toast("失効しました", "ok"); loadQuotes(); }
    else toast(res.data.message || "失効失敗", "err");
  }
  $("#btnNewQuote").addEventListener("click", async () => {
    // quote_required サービスのみに絞ってセレクト構築
    if (servicesCache.length === 0) {
      const res = await api("/api/admin/services");
      if (res.ok) servicesCache = res.data.services || [];
    }
    const sel = $("#q_service_id");
    sel.innerHTML = '<option value="">— 選択 —</option>';
    for (const s of servicesCache.filter((x) => x.service_type === "quote_required")) {
      const o = document.createElement("option");
      o.value = s.id; o.textContent = `${s.name} (${s.slug})`;
      sel.appendChild(o);
    }
    $("#q_customer_email").value = "";
    $("#q_customer_name").value = "";
    $("#q_customer_company").value = "";
    $("#q_min_amount").value = "";
    $("#q_recommended_amount").value = "";
    $("#q_scope_description").value = "";
    $("#q_expires_days").value = "30";
    $("#quoteModal").showModal();
  });
  $("#quoteCancel").addEventListener("click", () => $("#quoteModal").close());
  $("#quoteForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const body = {
      service_id: Number($("#q_service_id").value),
      customer_email: $("#q_customer_email").value,
      customer_name: $("#q_customer_name").value,
      customer_company: $("#q_customer_company").value,
      min_amount: Number($("#q_min_amount").value),
      recommended_amount: $("#q_recommended_amount").value ? Number($("#q_recommended_amount").value) : null,
      scope_description: $("#q_scope_description").value,
      expires_days: Number($("#q_expires_days").value),
    };
    const res = await api("/api/admin/quotes", { method: "POST", body });
    if (res.ok) {
      $("#quoteModal").close();
      toast("発行しました — 一覧から URL をコピーできます", "ok");
      loadQuotes();
    } else {
      toast(res.data.message || "発行失敗", "err");
    }
  });

  // -------------------- Subscriptions --------------------
  async function loadSubscriptions() {
    const status = $("#subsStatus").value || "active";
    const { ok, data } = await api(`/api/admin/subscriptions?status=${encodeURIComponent(status)}&limit=200`);
    const summaryBox = $("#subsSummary");
    const list = $("#subsList");
    while (summaryBox.firstChild) summaryBox.removeChild(summaryBox.firstChild);
    while (list.firstChild) list.removeChild(list.firstChild);

    if (!ok) {
      list.appendChild(el("div", { class: "muted" }, data.message || "取得失敗"));
      return;
    }
    // サマリ
    const summary = data.summary || [];
    const active = summary.find((s) => ["active", "trialing"].includes(s.status));
    const canceled = summary.find((s) => s.status === "canceled");
    const total = summary.reduce((a, s) => a + Number(s.total_mrr || 0), 0);
    const activeMrr = summary
      .filter((s) => ["active", "trialing"].includes(s.status))
      .reduce((a, s) => a + Number(s.total_mrr || 0), 0);
    summaryBox.appendChild(statCard("稼働中契約", (active?.count || 0) + " 件"));
    summaryBox.appendChild(statCard("解約済", (canceled?.count || 0) + " 件"));
    summaryBox.appendChild(statCard("月次売上 (MRR)", yen(activeMrr)));
    summaryBox.appendChild(statCard("累計契約数", summary.reduce((a, s) => a + Number(s.count || 0), 0) + " 件"));

    const subs = data.subscriptions || [];
    if (subs.length === 0) {
      list.appendChild(el("div", { class: "muted" }, "該当なし"));
      return;
    }
    for (const s of subs) {
      const typeTag = el("span", { class: `adm-tag adm-tag--${s.service_type === "instant" ? "instant" : "quote"}` }, s.service_type || "-");
      const statusTag = el("span", { class: `adm-tag adm-tag--${s.status === "active" ? "ok" : s.status === "canceled" ? "muted" : "warn"}` }, s.status);
      const card = el("div", { class: "adm-list__item" },
        el("div", { class: "adm-list__main" },
          el("div", { class: "adm-list__title" },
            s.customer_name || s.customer_email || "(顧客不明)", " ",
            typeTag, " ", statusTag
          ),
          el("div", { class: "adm-list__sub" },
            `${s.service_name || s.service_slug || "-"} / 月額 ${yen(s.current_amount)} (契約時最低 ${yen(s.min_amount_at_contract)}) / 開始 ${s.started_at ? fmtDate(s.started_at) : "-"}`
          ),
          el("div", { class: "muted small" }, `sub: ${s.stripe_subscription_id}`)
        ),
        el("div", { class: "adm-list__actions" },
          el("button", { class: "btn", onClick: () => showSubDetail(s.id) }, "詳細")
        ),
      );
      list.appendChild(card);
    }
  }
  $("#subsStatus").addEventListener("change", loadSubscriptions);

  async function showSubDetail(id) {
    const body = $("#subDetailBody");
    while (body.firstChild) body.removeChild(body.firstChild);
    body.appendChild(el("div", { class: "muted" }, "loading…"));
    $("#subDetailModal").showModal();
    const { ok, data } = await api(`/api/admin/subscriptions?id=${encodeURIComponent(id)}`);
    while (body.firstChild) body.removeChild(body.firstChild);
    if (!ok) {
      body.appendChild(el("div", { class: "muted" }, data.message || "取得失敗"));
      return;
    }
    const s = data.subscription;
    body.appendChild(el("h3", {}, `契約 #${s.id}`));
    body.appendChild(kv("Stripe Subscription", s.stripe_subscription_id));
    body.appendChild(kv("顧客", `${s.customer_name || "-"} <${s.customer_email || "-"}>${s.customer_company ? " / " + s.customer_company : ""}`));
    body.appendChild(kv("Stripe Customer", s.stripe_customer_id));
    body.appendChild(kv("サービス", `${s.service_name || "-"} (${s.service_slug || "-"}, ${s.service_type || "-"})`));
    body.appendChild(kv("契約時最低額 (snapshot)", yen(s.min_amount_at_contract)));
    body.appendChild(kv("現在月額", yen(s.current_amount)));
    body.appendChild(kv("ステータス", s.status));
    body.appendChild(kv("開始", s.started_at ? fmtDate(s.started_at) : "-"));
    body.appendChild(kv("次回請求", s.next_billing_at ? fmtDate(s.next_billing_at) : "-"));
    body.appendChild(kv("期間末解約予約", s.cancel_at_period_end ? "はい" : "いいえ"));
    body.appendChild(kv("解約日時", s.canceled_at ? fmtDate(s.canceled_at) : "-"));
    if (data.quote) {
      body.appendChild(el("h4", {}, "見積 (quote_required)"));
      body.appendChild(kv("quote.id", data.quote.id));
      body.appendChild(kv("発行者", data.quote.issued_by));
      body.appendChild(kv("最低額", yen(data.quote.min_amount)));
      body.appendChild(kv("ステータス", data.quote.status));
    }
    body.appendChild(el("h4", {}, "支払履歴"));
    if ((data.payments || []).length === 0) {
      body.appendChild(el("div", { class: "muted small" }, "支払いなし"));
    } else {
      const tbl = el("table", { class: "adm-table" });
      tbl.appendChild(el("thead", {}, el("tr", {},
        el("th", {}, "日付"), el("th", {}, "金額"), el("th", {}, "ステータス"), el("th", {}, "Invoice"))));
      const tb = el("tbody");
      for (const p of data.payments) {
        tb.appendChild(el("tr", {},
          el("td", {}, p.paid_at ? fmtDate(p.paid_at) : fmtDate(p.created_at)),
          el("td", {}, yen(p.amount)),
          el("td", {}, p.status + (p.failure_reason ? ` (${p.failure_reason})` : "")),
          el("td", { class: "muted small" }, p.stripe_invoice_id || "-")));
      }
      tbl.appendChild(tb);
      body.appendChild(tbl);
    }
    if ((data.pricing_history || []).length > 0) {
      body.appendChild(el("h4", {}, "料金改定履歴"));
      const tbl = el("table", { class: "adm-table" });
      tbl.appendChild(el("thead", {}, el("tr", {},
        el("th", {}, "日時"), el("th", {}, "旧→新"), el("th", {}, "変更者"), el("th", {}, "理由"))));
      const tb = el("tbody");
      for (const h of data.pricing_history) {
        tb.appendChild(el("tr", {},
          el("td", {}, fmtDate(h.changed_at)),
          el("td", {}, `${yen(h.old_amount)} → ${yen(h.new_amount)}`),
          el("td", {}, h.changed_by || "-"),
          el("td", { class: "muted small" }, h.reason || "")));
      }
      tbl.appendChild(tb);
      body.appendChild(tbl);
    }
  }
  $("#subDetailClose").addEventListener("click", () => $("#subDetailModal").close());

  function kv(label, value) {
    return el("div", { class: "adm-kv" },
      el("div", { class: "adm-kv__k" }, label),
      el("div", { class: "adm-kv__v" }, value || "-"));
  }
  function statCard(label, value) {
    return el("div", { class: "adm-card" },
      el("div", { class: "muted small" }, label),
      el("div", { style: "font-size:1.4rem;font-weight:600;margin-top:4px;" }, value));
  }

  // -------------------- Customers --------------------
  let custSearchTimer = null;
  async function loadCustomers() {
    const q = $("#custSearch").value.trim();
    const { ok, data } = await api(`/api/admin/customers${q ? "?q=" + encodeURIComponent(q) : ""}`);
    const list = $("#customersList");
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!ok) {
      list.appendChild(el("div", { class: "muted" }, data.message || "取得失敗"));
      return;
    }
    const customers = data.customers || [];
    if (customers.length === 0) {
      list.appendChild(el("div", { class: "muted" }, "顧客がまだいません"));
      return;
    }
    for (const c of customers) {
      list.appendChild(el("div", { class: "adm-list__item" },
        el("div", { class: "adm-list__main" },
          el("div", { class: "adm-list__title" },
            c.name || "(無名)", " ",
            el("span", { class: "muted small" }, `<${c.email}>`),
            c.company ? el("span", { class: "muted small" }, ` / ${c.company}`) : null,
          ),
          el("div", { class: "adm-list__sub" },
            `契約: 稼働 ${c.active_count} 件 / 累計 ${c.sub_count} 件 / 登録 ${fmtDate(c.created_at)}`
          ),
          el("div", { class: "muted small" }, `cus: ${c.stripe_customer_id}`),
        )));
    }
  }
  $("#custSearch").addEventListener("input", () => {
    clearTimeout(custSearchTimer);
    custSearchTimer = setTimeout(loadCustomers, 300);
  });

  // -------------------- Init --------------------
  loadStatus();
})();
