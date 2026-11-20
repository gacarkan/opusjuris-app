// Opus Juris Accounts: the page a firm's administrator uses to see the firm's
// plan, usage, tokens and seats, to choose how the firm pays (bank debit,
// card, or wire) and to see invoices. Opus Juris staff see every account and
// set each firm's terms from the same page.
// Sign in is the firm code and admin email plus a one-time code emailed
// to that address (Supabase Auth); Opus Juris staff sign in with their
// opusjuris.com email alone and get the company screen (firms, money,
// invoices across firms) instead of a firm's. Everything else goes to the back end
// (Python on PythonAnywhere, the opusjuris-backend repo), which checks the
// signed-in email against the account. Card and bank details are entered on
// Stripe's own page, never here.
(function () {
  "use strict";
  const cfg = window.BILLING_CONFIG || {};
  // The session is kept in the tab only (sessionStorage), so closing the
  // browser ends it and the next visit asks for a code again.
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { storage: window.sessionStorage } });
  const API = String(cfg.apiBase || "").replace(/\/+$/, "");
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const money = (cents, cur) => new Intl.NumberFormat("en-US", { style: "currency", currency: (cur || "usd").toUpperCase() }).format((cents || 0) / 100);
  const usd = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(n) || 0);
  const day = (secs) => (secs ? new Date(secs * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");
  const dateText = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");
  const label = (s) => String(s || "").replace(/_/g, " ");
  // The firm code rides in the tab with the session; a new tab or a new
  // visit starts at the sign-in form.
  const REF_KEY = "oj-account-ref";
  // What rides in the tab for a staff session instead of a firm code (a
  // firm code is letters, digits and dashes, so this can never be one).
  const OWNER_REF = "@staff";
  const STAFF_MAIL = /@opusjuris\.com$/i;
  let ref = "", pending = { ref: "", email: "" }, current = null;
  const getRef = () => { try { return sessionStorage.getItem(REF_KEY) || ""; } catch (e) { return ""; } };
  const setRef = (v) => { try { v ? sessionStorage.setItem(REF_KEY, v) : sessionStorage.removeItem(REF_KEY); } catch (e) { /* private mode: the code is asked for again */ } };

  async function call(action, extra, authed) {
    const headers = { "Content-Type": "application/json" };
    if (authed) {
      const { data } = await sb.auth.getSession();
      if (!data || !data.session) throw new Error("expired");
      headers.Authorization = "Bearer " + data.session.access_token;
    }
    let res;
    try { res = await fetch(API + "/api/" + action, { method: "POST", headers, body: JSON.stringify(extra || {}) }); }
    catch (e) { throw new Error("The accounts service could not be reached. Try again in a moment."); }
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error("expired");
    if (!res.ok || !j.ok) throw new Error(j.error || "Something went wrong. Please try again.");
    return j;
  }
  const tokens = (v) => (Math.round((Number(v) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  async function expiredOut(err, where) {
    if (err.message !== "expired") return false;
    await sb.auth.signOut({ scope: "local" });
    showSignin("Please sign in again.");
    return true;
  }

  // ── sign in ──
  function showSignin(msg) {
    $("app").classList.add("hidden");
    $("signin").classList.remove("hidden");
    $("form-ref").classList.remove("hidden");
    $("form-code").classList.add("hidden");
    $("signin-err").textContent = msg || "";
  }
  // An opusjuris.com address is staff: the firm code box goes away
  function staffMode() {
    const staff = STAFF_MAIL.test($("email").value.trim());
    $("ref-wrap").classList.toggle("hidden", staff);
    $("ref").required = !staff;
    $("signin-sub").textContent = staff ? "Opus Juris staff." : "Your firm's Opus Juris account.";
    return staff;
  }
  $("email").addEventListener("input", staffMode);
  $("form-ref").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("signin-err").textContent = "";
    const staff = staffMode();
    pending = { ref: staff ? "" : $("ref").value.trim().toUpperCase(), email: $("email").value.trim().toLowerCase(), staff };
    $("send").disabled = true;
    try {
      await call("request-code", pending, false);
      $("sent-to").textContent = pending.email;
      $("form-ref").classList.add("hidden");
      $("form-code").classList.remove("hidden");
      clearCode();
      focusBox(0);
    } catch (err) { $("signin-err").textContent = err.message; }
    $("send").disabled = false;
  });
  // The code: six boxes, one digit each, as the app's own code screens. Typing
  // advances, backspace retreats, pasting the code from the email fills the
  // row, and the sixth digit signs in on its own.
  const DIGITS = 6;
  const boxes = [];
  (function buildCode() {
    const row = $("code-row");
    for (let i = 0; i < DIGITS; i++) {
      const b = document.createElement("input");
      b.type = "text"; b.inputMode = "numeric"; b.maxLength = 1; b.autocomplete = i === 0 ? "one-time-code" : "off";
      b.setAttribute("aria-label", "Digit " + (i + 1));
      b.addEventListener("input", () => {
        const d = (b.value || "").replace(/[^0-9]/g, "").slice(-1);
        b.value = d;
        codeChanged();
        if (d && i < DIGITS - 1) focusBox(i + 1);
        if (d && i === DIGITS - 1 && codeValue().length === DIGITS) verify();
      });
      b.addEventListener("keydown", (e) => {
        if (e.key === "Backspace") { e.preventDefault(); if (b.value) { b.value = ""; } else if (i > 0) { boxes[i - 1].value = ""; focusBox(i - 1); } codeChanged(); }
        else if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); focusBox(i - 1); }
        else if (e.key === "ArrowRight" && i < DIGITS - 1) { e.preventDefault(); focusBox(i + 1); }
      });
      b.addEventListener("paste", (e) => {
        const t = (e.clipboardData.getData("text") || "").replace(/[^0-9]/g, "").slice(0, DIGITS);
        if (!t) return;
        e.preventDefault();
        boxes.forEach((x, k) => { x.value = t[k] || ""; });
        codeChanged();
        focusBox(Math.min(t.length, DIGITS - 1));
        if (t.length === DIGITS) verify();
      });
      row.appendChild(b); boxes.push(b);
    }
  })();
  function focusBox(i) { const b = boxes[Math.max(0, Math.min(DIGITS - 1, i))]; if (b) { b.focus(); b.select(); } }
  function codeValue() { return boxes.map((b) => b.value).join(""); }
  function codeChanged() { boxes.forEach((b) => b.classList.toggle("filled", !!b.value)); $("verify").disabled = codeValue().length !== DIGITS; $("signin-err").textContent = ""; }
  function clearCode() { boxes.forEach((b) => { b.value = ""; }); codeChanged(); }
  let verifying = false;
  async function verify() {
    const code = codeValue();
    if (verifying || code.length !== DIGITS) return;
    verifying = true;
    $("signin-err").textContent = "";
    $("verify").disabled = true;
    $("verify").textContent = "Checking";
    const { data, error } = await sb.auth.verifyOtp({ email: pending.email, token: code, type: "email" });
    verifying = false;
    $("verify").textContent = "Sign in";
    if (error || !data || !data.session) { $("signin-err").textContent = "That code is wrong or has expired. Check it, or ask for a new one."; clearCode(); focusBox(0); return; }
    ref = pending.staff ? OWNER_REF : pending.ref;
    setRef(ref);
    enter();
  }
  $("form-code").addEventListener("submit", (e) => { e.preventDefault(); verify(); });
  $("back").addEventListener("click", () => { clearCode(); showSignin(""); });
  $("signout").addEventListener("click", async () => { await sb.auth.signOut({ scope: "local" }); setRef(""); location.href = location.pathname; });

  // ── the account ──
  function flash(kind, text) { const f = $("flash"); f.className = "banner " + kind; f.textContent = text; }
  // Placeholders in every spot a figure will land, so the page keeps its
  // shape while the account loads instead of filling in piece by piece.
  function skeleton() {
    const sk = (w) => '<span class="skel" style="width:' + w + '"></span>';
    const lines = (n) => Array.from({ length: n }, () => '<span class="skel line"></span>').join("");
    $("firm").innerHTML = sk("220px");
    $("status").textContent = ""; $("sub-status").textContent = "";
    for (const id of ["st-usage", "st-tokens", "st-seats"]) { $(id).innerHTML = sk("72%"); $(id + "-s").innerHTML = sk("55%"); }
    $("plan-terms").innerHTML = ""; $("sum-rows").innerHTML = ""; $("sum-amt").innerHTML = sk("130px"); $("sum-per").textContent = "";
    $("usage-period").textContent = "";
    const hs = [18, 30, 22, 46, 38, 26, 60, 44, 32, 52, 70, 48, 36, 58, 42, 28, 64, 50, 34, 56, 72, 40, 30, 62, 46, 38, 54, 44, 26, 48];
    $("chart").innerHTML = '<div class="skel-chart">' + hs.map((p) => '<i style="height:' + p + '%"></i>').join("") + '</div><div class="axis"><span class="skel" style="width:52px"></span><span class="skel" style="width:52px"></span></div>';
    $("chart-range").innerHTML = '<span class="skel" style="width:150px;height:30px;border-radius:8px"></span>'; $("chart-view").innerHTML = '<span class="skel" style="width:64px;height:30px;border-radius:8px"></span>';
    $("bd-list").innerHTML = lines(4); $("bd-tabs").innerHTML = ""; $("bd-sub").textContent = ""; $("tokens-warn").textContent = "";
    closeEmbedded();
    payState.wire = undefined;
    for (const id of ["saved", "pay-opts", "pm-change", "pm-cancel"]) $(id).classList.add("hidden");
    $("pm-skel").classList.remove("hidden");
    $("invoices").className = ""; $("invoices").innerHTML = lines(2);
  }
  async function enter() {
    if (ref === OWNER_REF) return enterOwner();
    $("signin").classList.add("hidden");
    $("app").classList.remove("hidden");
    showFirm();
    showTab(location.hash === "#billing" ? "billing" : "usage");
    if (!current) skeleton();
    // Coming back from Stripe: ?setup=cs_... when something was added, ?setup=cancel when it was not.
    const q = new URLSearchParams(location.search).get("setup");
    if (q) { history.replaceState(null, "", location.pathname + "#billing"); showTab("billing"); }
    try {
      if (q && /^cs_/.test(q)) {
        try { await call("complete-setup", { ref, session_id: q }, true); flash("ok", "Your payment method was saved."); }
        catch (err) { if (err.message === "expired") throw err; flash("bad", err.message); }
      } else if (q === "cancel") flash("warn", "Nothing was changed.");
      await refresh();
    } catch (err) {
      if (await expiredOut(err)) return;
      flash("bad", err.message);
    }
  }
  async function refresh() {
    const j = await call("overview", { ref }, true);
    current = j;
    render(j);
  }
  function render(j) {
    const a = j.account, p = j.plan, m = j.method, u = j.usage || {};
    const sub = (j.subscriptions || []).find((s) => s.status !== "canceled") || null;
    const pay = (p && p.pay_by) || "auto";
    $("me").textContent = a.admin_email;
    $("firm").textContent = a.firm_name;
    const st = $("status");
    const standing = !p ? ["Custom plan", ""] : sub && sub.status === "past_due" ? ["Past due", "past_due"] : sub && sub.status === "unpaid" ? ["Unpaid", "unpaid"] : ["Active", "active"];
    st.textContent = standing[0]; st.className = "tag " + standing[1];
    // usage: the period, the total at the firm's rate, by day, by case, by person
    const mo = u.month, tk = u.tokens, s = u.seats;
    const onTokens = tk && tk.left !== null && tk.left !== undefined;
    // the window start is a moment in UTC; shown as the local day it fell on
    const localDay = (iso) => { const d = new Date(iso); return isNaN(d) ? String(iso).slice(0, 10) : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    const since = mo && mo.on_tokens && mo.window_start ? localDay(mo.window_start) : null;
    const periodText = since ? "since " + dateText(since) : "this month";
    $("usage-period").textContent = "Since " + (since ? dateText(since) : "the start of the month") + ", at your firm\u2019s prices.";
    const total = mo && mo.total_usd != null ? Number(mo.total_usd) : null;
    $("st-usage-k").textContent = "Usage " + periodText;
    $("st-usage").textContent = total != null ? usd(total) : (onTokens ? tokens(tk.used) + " tokens" : "n/a");
    $("st-usage-s").textContent = onTokens ? tokens(tk.used) + " tokens used" : (mo && mo.days_left != null ? mo.days_left + " days left in the month" : "");
    $("st-tokens").textContent = onTokens ? tokens(tk.left) : "n/a";
    $("st-tokens-s").textContent = onTokens ? "of " + tokens(tk.granted) : "Not on tokens";
    $("st-seats").textContent = s ? String(s.used) : "n/a";
    $("st-seats-s").textContent = s && s.seats ? "of " + s.seats + " included" : "in use";
    chartState.since = since;
    renderChart(u.series || []);
    renderBreakdown(mo, periodText);
    $("tokens-warn").textContent = onTokens && Number(tk.left) <= 0 ? "No tokens left: drafting, analysis and chat are paused until more tokens are added." : "";
    // the summary: the amount, the terms, what comes next
    const price = p ? (p.discounted ? p.bank_monthly_usd : p.monthly_usd) : null;
    const today = new Date().toISOString().slice(0, 10);
    const ss = $("sub-status");
    if (sub) { ss.textContent = label(sub.status); ss.className = "tag " + esc(sub.status); } else { ss.textContent = ""; ss.className = "tag"; }
    const mt = methodText(m, pay);
    if (p) {
      $("sum-amt").textContent = usd(price); $("sum-per").textContent = "per month";
      $("plan-terms").textContent = "";
      const rows = [["Plan", "Custom"], ["Term", p.term_months + (p.term_months === 1 ? " month" : " months")], [p.starts_on > today ? "Starts" : "Started", dateText(p.starts_on)], ["Ends", dateText(p.ends_on)]];
      if (p.discounted && Number(p.bank_discount_pct) > 0) rows.push(["Bank discount", Number(p.bank_discount_pct) + "% off " + usd(p.monthly_usd)]);
      rows.push(["Payment", mt.short]);
      const next = sub && sub.current_period_end ? [sub.cancel_at_period_end ? "Final payment" : "Next payment", usd(price), day(sub.current_period_end)]
        : p.starts_on > today ? ["First payment", usd(price), dateText(p.starts_on)] : ["Each month", usd(price), ""];
      $("sum-rows").innerHTML = rows.map((r) => "<div><span>" + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>").join("") + '<div class="total"><span>' + esc(next[0]) + (next[2] ? "<small>" + esc(next[2]) + "</small>" : "") + "</span><b>" + esc(next[1]) + "</b></div>";
    } else {
      $("sum-amt").textContent = "Custom plan"; $("sum-per").textContent = "";
      $("sum-rows").innerHTML = "";
      $("plan-terms").textContent = "Your terms are agreed with Opus Juris and appear here once set.";
    }
    // the payment method step: the saved method as one row, or the ways to pay
    $("pm-skel").classList.add("hidden");
    const mark = markFor(m, pay);
    $("saved-mark").innerHTML = mark.svg; $("saved-mark").className = "brandmark" + (mark.plain ? " plain" : "");
    $("saved-title").textContent = mt.long; $("saved-note").textContent = mt.note;
    $("saved-tag").textContent = m && pay !== "wire" ? "Default" : "";
    $("price-card").textContent = p ? usd(p.monthly_usd) + " / month" : "";
    $("price-bank").textContent = p ? usd(p.bank_monthly_usd) + " / month" : "";
    $("price-wire").textContent = p ? usd(p.bank_monthly_usd) + " / month" : "";
    const save = p && Number(p.bank_discount_pct) > 0 ? "Save " + Number(p.bank_discount_pct) + "%" : "";
    $("save-bank").textContent = save; $("save-wire").textContent = save;
    if (pay === "wire") { payState.wire = j.wire || null; payState.wireNote = j.wire_instructions || ""; }
    $("wire-box-saved").innerHTML = pay === "wire" ? wireBox(payState.wire, payState.wireNote) : "";
    payState.saved = !!m || pay === "wire";
    payState.current = pay === "wire" ? "wire" : m ? m.type : "";
    showPay(!payState.saved);
    // invoices
    const inv = j.invoices || [];
    $("invoices").className = inv.length ? "" : "empty";
    $("invoices").innerHTML = inv.length ? '<table><thead><tr><th>Invoice</th><th class="hide-sm">Date</th><th>Status</th><th class="num">Amount</th><th class="num"></th></tr></thead><tbody>' + inv.map((i) => {
      const amt = i.status === "paid" ? i.amount_paid : i.amount_due;
      const act = i.status === "open" && i.hosted_invoice_url ? '<a class="btn sm" href="' + esc(i.hosted_invoice_url) + '" target="_blank" rel="noopener">Pay</a>' : (i.invoice_pdf ? '<a class="link" href="' + esc(i.invoice_pdf) + '" target="_blank" rel="noopener">PDF</a>' : "");
      return "<tr><td>" + esc(i.number || "Invoice") + '</td><td class="hide-sm">' + esc(day(i.created)) + '</td><td><span class="tag ' + esc(i.status) + '">' + esc(label(i.status)) + '</span></td><td class="num">' + esc(money(amt, i.currency)) + '</td><td class="num">' + act + "</td></tr>";
    }).join("") + "</tbody></table>" : (p ? "Your first invoice appears here on " + dateText(p.starts_on) + "." : "Your invoices appear here once your plan starts.");
  }
  // Where the usage went: one list at a time, cases or people, each row a
  // name, a bar for its share and the amount.
  const bdState = { tab: "case" };
  function renderBreakdown(mo, periodText) {
    bdState.mo = mo; bdState.period = periodText;
    drawBreakdown();
  }
  function drawBreakdown() {
    const mo = bdState.mo || {};
    const who = (x) => { if (x.name && x.name !== x.email) return x.name; const local = String(x.email || "").split("@")[0]; return local ? local.charAt(0).toUpperCase() + local.slice(1) : "Unknown"; };
    const rows = bdState.tab === "case"
      ? ((mo.by_case) || []).map((c) => ({ n: c.case_ref === "other" ? "Other work" : "Case " + c.case_ref, v: Number(c.usd) || 0 }))
      : ((mo.by_user) || []).map((x) => ({ n: who(x), v: Number(x.usd) || 0 }));
    const sum = rows.reduce((s, r) => s + r.v, 0), max = Math.max(...rows.map((r) => r.v), 0);
    const top = rows.slice(0, 6), rest = rows.slice(6);
    $("bd-tabs").innerHTML = [["case", "Cases"], ["user", "People"]].map((t) => '<button type="button" class="seg' + (bdState.tab === t[0] ? " on" : "") + '" data-tab="' + t[0] + '">' + t[1] + "</button>").join("");
    $("bd-tabs").querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { bdState.tab = b.dataset.tab; drawBreakdown(); }));
    $("bd-sub").textContent = rows.length ? (bdState.tab === "case" ? "By case, " : "By person, ") + bdState.period + "." : "";
    $("bd-list").innerHTML = top.length ? top.map((r) => '<div class="brow"><span class="n">' + esc(r.n) + '</span><span class="a">' + esc(usd(r.v)) + '</span><span class="t"><i style="width:' + (max > 0 ? Math.max(1, Math.round(r.v / max * 100)) : 0) + '%"></i></span></div>').join("")
      + (rest.length ? '<div class="brow"><span class="n more">' + rest.length + (bdState.tab === "case" ? " more cases" : " more people") + '</span><span class="a more">' + esc(usd(rest.reduce((s, r) => s + r.v, 0))) + "</span></div>" : "")
      : '<div class="empty">Nothing yet.</div>';
  }
  // The usage chart: one colour, dollar gridlines, date ticks, rounded bars,
  // a tooltip that follows the pointer, and a table as the other view.
  const chartState = { range: 30, view: "chart", series: [] };
  const ICON_CHART = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>';
  const ICON_TABLE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="10" y1="4" x2="10" y2="20"/></svg>';
  function renderChart(series) {
    chartState.series = series || [];
    const st = chartState;
    $("chart-range").innerHTML = [7, 30, 90].map((n) => '<button type="button" class="seg' + (st.range === n ? " on" : "") + '" data-range="' + n + '">' + n + " days</button>").join("");
    $("chart-view").innerHTML = '<button type="button" class="seg' + (st.view === "chart" ? " on" : "") + '" data-view="chart" aria-label="Chart">' + ICON_CHART + '</button><button type="button" class="seg' + (st.view === "table" ? " on" : "") + '" data-view="table" aria-label="Table">' + ICON_TABLE + "</button>";
    $("chart-range").querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => { st.range = Number(b.dataset.range); renderChart(st.series); }));
    $("chart-view").querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { st.view = b.dataset.view; renderChart(st.series); }));
    drawChart();
  }
  function chartDays() {
    const st = chartState, byDay = {};
    for (const r of st.series) { const d = String(r.day).slice(0, 10); byDay[d] = (byDay[d] || 0) + (Number(r.usd) || 0); }
    const days = [];
    // days before the tokens began are not charged and show as empty
    for (let k = st.range - 1; k >= 0; k--) { const d = new Date(); d.setDate(d.getDate() - k); const key = d.toISOString().slice(0, 10); days.push({ key, v: st.since && key < st.since ? 0 : (byDay[key] || 0) }); }
    return days;
  }
  // a round step for the gridlines: 1, 2 or 5 times a power of ten
  function niceStep(max, lines) {
    const raw = max / lines, p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    for (const m of [1, 2, 5, 10]) { if (m * p >= raw) return m * p; }
    return 10 * p;
  }
  function drawChart() {
    const el = $("chart"), st = chartState, days = chartDays();
    if (st.view === "table") {
      const rows = days.slice().reverse().filter((d) => d.v > 0);
      const total = days.reduce((s, d) => s + d.v, 0);
      el.innerHTML = rows.length ? "<table><thead><tr><th>Day</th><th class=\"num\">Usage</th></tr></thead><tbody>" + rows.map((d) => "<tr><td>" + esc(dateText(d.key)) + '</td><td class="num">' + esc(usd(d.v)) + "</td></tr>").join("") + '<tr><td><b>' + (st.since && days[0].key < st.since ? "Total since " + dateText(st.since) : "Total, " + st.range + " days") + '</b></td><td class="num"><b>' + esc(usd(total)) + "</b></td></tr></tbody></table>" : '<div class="empty">No usage in the last ' + st.range + " days.</div>";
      return;
    }
    const W = Math.max(320, el.clientWidth || 640), H = 240, L = 44, R = 8, T = 10, B = 26;
    const max = Math.max(...days.map((d) => d.v), 0);
    const step = max > 0 ? niceStep(max, 4) : 1;
    const top = max > 0 ? Math.ceil(max / step) * step : 4;
    const iw = W - L - R, ih = H - T - B;
    const y = (v) => T + ih - (v / top) * ih;
    let g = "";
    for (let v = 0; v <= top + 1e-9; v += step) {
      g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>';
      g += '<text class="ylab" x="' + (L - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + esc(usd(v).replace(/\.00$/, "")) + "</text>";
    }
    const slot = iw / days.length, bw = Math.max(2, Math.min(slot * 0.62, 28));
    let bars = "";
    days.forEach((d, n) => {
      const x = L + n * slot + (slot - bw) / 2, hgt = d.v > 0 ? Math.max(2, (d.v / top) * ih) : 0;
      if (hgt) bars += '<rect class="cbar" data-i="' + n + '" x="' + x.toFixed(1) + '" y="' + (T + ih - hgt).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hgt.toFixed(1) + '" rx="3"/>';
    });
    const every = days.length > 60 ? 15 : days.length > 14 ? 5 : 1;
    let xl = "";
    days.forEach((d, n) => { if (n % every === 0 || n === days.length - 1) xl += '<text class="xlab" x="' + (L + n * slot + slot / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(new Date(d.key + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })) + "</text>"; });
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-label="Usage by day">' + g + bars + xl + "</svg>" + (max > 0 ? "" : '<div class="empty" style="position:absolute;inset:0;display:grid;place-items:center">No usage in the last ' + st.range + " days.</div>");
    const svg = el.querySelector("svg");
    const tip = document.createElement("div"); tip.className = "tip"; tip.style.opacity = "0"; el.appendChild(tip);
    const band = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    band.setAttribute("class", "band"); band.setAttribute("y", T); band.setAttribute("height", ih); band.setAttribute("width", slot.toFixed(1)); band.setAttribute("x", L); band.style.opacity = "0";
    svg.insertBefore(band, svg.firstChild);
    let cur = -1;
    const place = (n) => {
      const d = days[n];
      tip.innerHTML = "<b>" + esc(usd(d.v)) + "</b>" + esc(dateText(d.key));
      tip.style.left = (L + n * slot + slot / 2) + "px";
      tip.style.top = (d.v > 0 ? y(d.v) : T + ih) + "px";
      tip.style.opacity = "1";
      band.setAttribute("x", (L + n * slot).toFixed(1)); band.style.opacity = "1";
    };
    svg.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const n = Math.max(0, Math.min(days.length - 1, Math.floor((e.clientX - r.left - L) / slot)));
      if (e.clientX - r.left < L) { return; }
      if (n !== cur) { cur = n; place(n); }
    });
    svg.addEventListener("mouseleave", () => { cur = -1; tip.style.opacity = "0"; band.style.opacity = "0"; });
  }
  window.addEventListener("resize", () => { if (current && chartState.view === "chart") drawChart(); });
  // One description of the way the firm pays, used by the tile and the card.
  const ICON_CARD = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>';
  const ICON_BANK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18"/><path d="M12 3l9 7H3l9-7z"/><path d="M5 10v8M10 10v8M14 10v8M19 10v8"/><path d="M3 21h18"/></svg>';
  const ICON_WIRE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M14 6l6 6-6 6"/></svg>';
  function methodText(m, pay) {
    if (pay === "wire") return { short: "Wire transfer", sub: "Invoiced by email", long: "Wire transfer", note: "Each invoice is emailed with the transfer details below and marked paid when the money arrives.", icon: ICON_WIRE };
    if (!m) return { short: "Not set", sub: "Add one to pay automatically", long: "No payment method on file", note: "Add one to pay each invoice automatically.", icon: ICON_CARD };
    if (m.type === "card") return { short: label(m.brand).replace(/^./, (c) => c.toUpperCase()) + " •••• " + m.last4, sub: m.exp_month ? "Expires " + String(m.exp_month).padStart(2, "0") + "/" + m.exp_year : "Card", long: label(m.brand).replace(/^./, (c) => c.toUpperCase()) + " card ending " + m.last4, note: m.exp_month ? "Expires " + String(m.exp_month).padStart(2, "0") + "/" + m.exp_year + ". Charged on each invoice." : "Charged on each invoice.", icon: ICON_CARD };
    if (m.type === "bank") return { short: "Bank •••• " + m.last4, sub: m.bank_name || "Bank debit", long: (m.bank_name || "Bank account") + " ending " + m.last4, note: "Bank debit (ACH), pulled on each invoice.", icon: ICON_BANK };
    return { short: "On file", sub: "", long: "Payment method on file", note: "", icon: ICON_CARD };
  }
  // The mark on the saved row: the card's brand, or a plain icon.
  const BRAND_MARKS = {
    visa: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><text x="15" y="14" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-style="italic" font-size="9.5" fill="#1a1f71">VISA</text></svg>',
    mastercard: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><circle cx="12" cy="10" r="5.5" fill="#eb001b"/><circle cx="18" cy="10" r="5.5" fill="#f79e1b" fill-opacity=".92"/></svg>',
    amex: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#2e77bc"/><text x="15" y="13" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="7" fill="#fff">AMEX</text></svg>',
    discover: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><text x="12.5" y="12.6" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="5" fill="#231f20">DISCOVER</text><circle cx="25" cy="10" r="3" fill="#f58220"/></svg>',
  };
  function markFor(m, pay) {
    if (pay === "wire") return { svg: ICON_WIRE, plain: true };
    if (m && m.type === "card" && BRAND_MARKS[String(m.brand || "").toLowerCase()]) return { svg: BRAND_MARKS[String(m.brand).toLowerCase()], plain: false };
    if (m && m.type === "bank") return { svg: ICON_BANK, plain: true };
    return { svg: ICON_CARD, plain: true };
  }
  // The ways to pay: a saved method shows as one row until Change; otherwise
  // the list is open and the chosen row expands with Stripe's form inside it
  // (with a publishable key) or sends the firm to Stripe's own page.
  let stripeJs = null, embedded = null;
  const payState = { saved: false, current: "", open: false, wire: undefined, wireNote: "" };
  // The transfer details as a list with Copy on each value; undefined while
  // they load, null when Stripe has none for this account yet.
  const ICON_COPY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  function wireBox(w, note) {
    if (w === undefined) return '<span class="skel line"></span><span class="skel line"></span><span class="skel line"></span>';
    if (!w) return '<div class="wire-head">Transfer details</div><div class="wire-row one"><span class="v">The transfer details are being set up and will be shown here. Each invoice email carries them' + (note ? ", and for now: " + esc(note) : "") + ".</span></div>";
    const rows = [["Account holder", w.account_holder], ["Bank", w.bank_name], ["Account number", w.account_number, "num"], ["Routing number", w.routing_number, "num"], ["SWIFT code", w.swift_code, "num"], ["Bank address", w.bank_address], ["Reference", ref, "num"]].filter((r) => r[1]);
    const all = rows.map((r) => r[0] + ": " + r[1]).join("\n");
    return '<div class="wire-head"><span>Transfer details</span><button type="button" class="link copy" data-copy="' + esc(all) + '">Copy all</button></div>'
      + rows.map((r) => '<div class="wire-row"><span class="k">' + esc(r[0]) + '</span><span class="v' + (r[2] ? " " + r[2] : "") + '">' + esc(r[1]) + '</span><button type="button" class="copy" data-copy="' + esc(r[1]) + '" aria-label="Copy ' + esc(r[0].toLowerCase()) + '">' + ICON_COPY + "Copy</button></div>").join("")
      + '<div class="wire-foot">ACH and wires inside the United States use the routing number; wires from abroad use the SWIFT code. Put your firm code <b>' + esc(ref) + "</b> in the reference so the payment is matched to your firm." + (note ? " " + esc(note) : "") + "</div>";
  }
  function copyText(text) {
    // the clipboard API where the page may use it; the selection trick elsewhere
    try { if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text); return true; } } catch (e) { /* below */ }
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".copy");
    if (!b) return;
    if (!copyText(b.dataset.copy)) return;
    const was = b.innerHTML;
    b.classList.add("done"); b.textContent = "Copied";
    setTimeout(() => { b.classList.remove("done"); b.innerHTML = was; }, 1600);
  });
  async function loadWire() {
    if (payState.wire !== undefined) { $("wire-box-row").innerHTML = wireBox(payState.wire, payState.wireNote); return; }
    $("wire-box-row").innerHTML = wireBox(undefined);
    try {
      const j = await call("wire-details", { ref }, true);
      payState.wire = j.wire || null; payState.wireNote = j.wire_instructions || "";
    } catch (err) { if (await expiredOut(err)) return; payState.wire = null; }
    $("wire-box-row").innerHTML = wireBox(payState.wire, payState.wireNote);
  }
  function stripeClient() {
    if (stripeJs) return stripeJs;
    if (!cfg.stripePublishableKey || !window.Stripe) return null;
    try { stripeJs = window.Stripe(cfg.stripePublishableKey); } catch (e) { stripeJs = null; }
    return stripeJs;
  }
  function closeEmbedded() {
    if (embedded) { try { embedded.destroy(); } catch (e) { /* already gone */ } embedded = null; }
    document.querySelectorAll(".pay-opt .host").forEach((h) => { h.innerHTML = ""; });
    document.querySelectorAll(".pay-opt .checkout-wait").forEach((w) => w.classList.add("hidden"));
  }
  function markOpt(kind) {
    document.querySelectorAll(".pay-opt").forEach((o) => {
      const on = o.dataset.pay === kind;
      o.classList.toggle("on", on);
      o.querySelector(".pay-head").setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  function showPay(open) {
    payState.open = open;
    closeEmbedded();
    markOpt("");
    $("saved").classList.toggle("hidden", !payState.saved || open);
    $("pay-opts").classList.toggle("hidden", !open);
    $("pm-change").classList.toggle("hidden", !payState.saved || open);
    $("pm-cancel").classList.toggle("hidden", !(payState.saved && open));
    $("pm-sub").textContent = open ? (payState.saved ? "Choose a new way to pay." : "Choose how your invoices are paid.") : "How your invoices are paid.";
    for (const k of ["card", "bank", "wire"]) $("cur-" + k).textContent = open && payState.current === k ? "Current" : "";
  }
  // The placeholder stays until Stripe's frame has content (it loads first
  // and grows once its fields are in), or 20 s at most.
  function waitForFrame(host, wait) {
    const started = Date.now();
    const tick = () => {
      const f = host.querySelector("iframe");
      const grown = f && f.getBoundingClientRect().height > 150;
      if (grown || Date.now() - started > 20000 || wait.classList.contains("hidden")) { wait.classList.add("hidden"); return; }
      setTimeout(tick, 250);
    };
    tick();
  }
  async function select(kind) {
    const opt = document.querySelector('.pay-opt[data-pay="' + kind + '"]');
    if (!opt || opt.classList.contains("on")) return;
    closeEmbedded();
    markOpt(kind);
    if (kind === "wire") { loadWire(); return; }
    const st = stripeClient();
    const wait = opt.querySelector(".checkout-wait"), host = opt.querySelector(".host");
    if (st) wait.classList.remove("hidden");
    try {
      const j = await call("setup-session", { ref, kind, embedded: !!st }, true);
      if (!st || !j.client_secret) { location.href = j.url; return; }
      if (!opt.classList.contains("on")) return; // moved on while the session was minted
      embedded = await st.initEmbeddedCheckout({
        clientSecret: j.client_secret,
        onComplete: async () => {
          closeEmbedded();
          try { await call("complete-setup", { ref, session_id: j.session_id }, true); flash("ok", "Your payment method was saved."); await refresh(); }
          catch (err) { if (await expiredOut(err)) return; flash("bad", err.message); }
        },
      });
      embedded.mount("#host-" + kind);
      waitForFrame(host, wait);
      opt.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) { if (await expiredOut(err)) return; closeEmbedded(); flash("bad", err.message); }
  }
  document.querySelectorAll(".pay-head").forEach((h) => h.addEventListener("click", () => select(h.closest(".pay-opt").dataset.pay)));
  $("wire-go").addEventListener("click", async () => {
    const b = $("wire-go"); b.disabled = true;
    try { payState.wire = undefined; await call("choose-pay", { ref, pay_by: "wire" }, true); flash("ok", "Wire transfer set. Each invoice arrives by email with the transfer details shown below."); await refresh(); }
    catch (err) { if (await expiredOut(err)) return; flash("bad", err.message); }
    finally { b.disabled = false; }
  });
  $("pm-change").addEventListener("click", () => showPay(true));
  $("pm-cancel").addEventListener("click", () => showPay(false));

  // ── the owner's screen: every account and its terms ──
  // Usage or Billing, kept in the address (#billing) so a refresh stays put
  function showTab(name) {
    const billing = name === "billing";
    $("tab-usage").classList.toggle("hidden", billing);
    $("tab-billing").classList.toggle("hidden", !billing);
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("on", b.dataset.tab === (billing ? "billing" : "usage")));
    const want = billing ? "#billing" : "";
    if (location.hash !== want) history.replaceState(null, "", location.pathname + want);
    if (!billing && chartState.view === "chart" && current) drawChart();
  }
  document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  function showFirm() { $("main-owner").classList.add("hidden"); $("nav-owner").classList.add("hidden"); $("main-firm").classList.remove("hidden"); $("nav-firm").classList.remove("hidden"); }
  function oflash(kind, text) { const f = $("owner-flash"); f.className = "banner " + (text ? kind : "hidden"); f.textContent = text || ""; }
  // Firms or Invoices, kept in the address (#invoices) so a refresh stays put
  function showOwnerTab(name) {
    const inv = name === "invoices";
    $("otab-firms").classList.toggle("hidden", inv);
    $("otab-invoices").classList.toggle("hidden", !inv);
    document.querySelectorAll("#nav-owner .nav-item").forEach((b) => b.classList.toggle("on", b.dataset.otab === (inv ? "invoices" : "firms")));
    const want = inv ? "#invoices" : "";
    if (location.hash !== want) history.replaceState(null, "", location.pathname + want);
  }
  document.querySelectorAll("#nav-owner .nav-item").forEach((b) => b.addEventListener("click", () => showOwnerTab(b.dataset.otab)));
  async function enterOwner() {
    $("signin").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("main-firm").classList.add("hidden"); $("nav-firm").classList.add("hidden");
    $("main-owner").classList.remove("hidden"); $("nav-owner").classList.remove("hidden");
    $("firm").textContent = "Opus Juris";
    const { data } = await sb.auth.getSession();
    $("me").textContent = data && data.session && data.session.user ? data.session.user.email : "";
    showOwnerTab(location.hash === "#invoices" ? "invoices" : "firms");
    const sk = (w) => '<span class="skel" style="width:' + w + '"></span>';
    for (const id of ["os-firms", "os-monthly", "os-open"]) { $(id).innerHTML = sk("60%"); $(id + "-s").innerHTML = sk("50%"); }
    await loadCompany();
  }
  // The standing of a firm as a word and a tag color
  function standingText(a) {
    const s = a.standing;
    if (s === "inactive") return ["Inactive", ""];
    if (s === "no_terms") return ["No terms yet", "no_terms"];
    if (s === "starts") return ["Starts " + dateText(a.starts_on), "starts"];
    if (s === "ended") return ["Ended", "canceled"];
    if (s === "active" || s === "trialing") return ["Active", "active"];
    if (s === "past_due") return ["Past due", "past_due"];
    if (s === "unpaid") return ["Unpaid", "unpaid"];
    if (s === "incomplete") return ["Payment failed", "unpaid"];
    if (s === "paused") return ["Paused", ""];
    return ["No subscription", "none"];
  }
  function invoiceRows(list, paid) {
    if (!list.length) return null;
    return '<table><thead><tr><th>Firm</th><th class="hide-sm">Invoice</th><th class="num">Amount</th><th>' + (paid ? "Paid" : "Due") + '</th><th></th></tr></thead><tbody>' + list.map((i) =>
      '<tr><td><b>' + esc(i.firm_name || "Unknown firm") + '</b><span class="sub-line">' + esc(i.ref_no) + '</span></td><td class="hide-sm">' + esc(i.number || "") + '</td><td class="num">' + esc(money(paid ? i.amount_paid : i.amount_due, i.currency)) + "</td><td>"
      + (paid ? esc(day(i.paid_at || i.created)) : esc(day(i.due_date)) + (i.past_due ? '<span class="tag past_due">Past due</span>' : "")) + '</td><td class="act">' + (i.hosted_invoice_url ? '<a class="link" href="' + esc(i.hosted_invoice_url) + '" target="_blank" rel="noopener">View</a>' : "") + "</td></tr>").join("") + "</tbody></table>";
  }
  let companyRows = [];
  async function loadCompany() {
    try {
      const j = await call("admin/overview", {}, true);
      const rows = j.accounts || [], t = j.totals || {};
      companyRows = rows;
      $("me").textContent = j.email || $("me").textContent;
      $("owner-sub").textContent = rows.length ? rows.length + (rows.length === 1 ? " firm" : " firms") + " on the books" : "";
      $("os-firms").textContent = String(t.firms_active || 0);
      $("os-firms-s").textContent = (t.firms_starting ? t.firms_starting + " starting later" : "") + (t.firms_starting && t.firms_attention ? ", " : "") + (t.firms_attention ? t.firms_attention + " need attention" : "") || "Active today";
      $("os-monthly").textContent = usd(t.monthly_usd || 0);
      $("os-monthly-s").textContent = "Agreed monthly terms";
      $("os-open").textContent = money(t.outstanding_cents || 0, "usd");
      $("os-open-s").textContent = t.open_count ? t.open_count + (t.open_count === 1 ? " open invoice" : " open invoices") + (t.past_due_count ? ", " + t.past_due_count + " past due" : "") : "No open invoices";
      $("owner-list").className = rows.length ? "acct-list" : "empty";
      $("owner-list").innerHTML = rows.length ? '<table><thead><tr><th>Firm</th><th class="hide-sm">Administrator</th><th class="num">Monthly</th><th class="hide-sm">Term</th><th class="hide-sm">Pays by</th><th>Standing</th><th></th></tr></thead><tbody>' + rows.map((a) => {
        const st = standingText(a);
        return '<tr data-ref="' + esc(a.ref_no) + '"><td><b>' + esc(a.firm_name) + '</b><span class="sub-line">' + esc(a.ref_no) + '</span></td><td class="hide-sm">' + esc(a.admin_email) + '</td><td class="num">' + (a.monthly_usd != null ? esc(usd(a.monthly_usd)) : "") + '</td><td class="hide-sm">' + (a.term_months ? esc(a.term_months + " mo from " + dateText(a.starts_on)) : "") + '</td><td class="hide-sm">' + (a.pay_by === "wire" ? "Wire" : "Saved method") + '</td><td><span class="tag ' + st[1] + '">' + esc(st[0]) + '</span></td><td class="act"><span class="link">Edit</span></td></tr>';
      }).join("") + "</tbody></table>" : "No firms yet. New firm starts the first one.";
      $("owner-list").querySelectorAll("tr[data-ref]").forEach((tr) => tr.addEventListener("click", () => edit(rows.find((a) => a.ref_no === tr.dataset.ref))));
      const open = invoiceRows(j.open_invoices || [], false), paid = invoiceRows(j.paid_invoices || [], true);
      $("owner-open").className = open ? "inv-list" : "empty"; $("owner-open").innerHTML = open || "Nothing outstanding.";
      $("owner-paid").className = paid ? "inv-list" : "empty"; $("owner-paid").innerHTML = paid || "No payments yet.";
    } catch (err) { if (await expiredOut(err)) return; oflash("bad", err.message); }
  }
  function edit(a) {
    oflash("", "");
    const f = $("owner-form");
    $("owner-edit").classList.remove("hidden");
    $("owner-edit-title").textContent = a ? a.firm_name : "New firm";
    f.ref_no.value = a ? a.ref_no : ""; f.ref_no.readOnly = !!a;
    f.firm_name.value = a ? a.firm_name : ""; f.admin_email.value = a ? a.admin_email : "";
    f.monthly_usd.value = a && a.monthly_usd != null ? a.monthly_usd : ""; f.term_months.value = a && a.term_months ? a.term_months : "";
    f.starts_on.value = a && a.starts_on ? a.starts_on : ""; f.bank_discount_pct.value = a && a.bank_discount_pct != null ? a.bank_discount_pct : 3;
    f.pay_by.value = a ? (a.pay_by || "auto") : "auto"; f.notes.value = a ? (a.notes || "") : ""; f.active.checked = a ? !!a.active : true;
    $("owner-edit").scrollIntoView({ behavior: "smooth", block: "start" });
    (a ? f.firm_name : f.ref_no).focus();
  }
  $("owner-new").addEventListener("click", () => edit(null));
  $("owner-cancel").addEventListener("click", () => $("owner-edit").classList.add("hidden"));
  $("owner-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = $("owner-form");
    const b = { ref_no: f.ref_no.value, firm_name: f.firm_name.value, admin_email: f.admin_email.value, monthly_usd: f.monthly_usd.value, term_months: f.term_months.value,
      starts_on: f.starts_on.value, bank_discount_pct: f.bank_discount_pct.value, pay_by: f.pay_by.value, notes: f.notes.value, active: f.active.checked };
    $("owner-save").disabled = true;
    try {
      const j = await call("admin/account", b, true);
      const a = j.account;
      oflash(j.warning ? "warn" : "ok", j.warning || (a ? "Saved " + a.firm_name + ". Its administrator signs in at app.opusjuris.com with firm code " + a.ref_no + " and " + a.admin_email + "." : "Saved."));
      $("owner-edit").classList.add("hidden");
      await loadCompany();
    } catch (err) { if (await expiredOut(err)) return; oflash("bad", err.message); }
    $("owner-save").disabled = false;
  });

  // ── start ──
  (async function boot() {
    const { data } = await sb.auth.getSession();
    ref = getRef();
    if (data && data.session && ref) return enter();
    if (data && data.session) await sb.auth.signOut({ scope: "local" });
    setRef("");
    showSignin("");
  })();
})();
