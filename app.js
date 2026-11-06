// Opus Juris Accounts: the page a firm's administrator uses to see the firm's
// plan, usage, tokens and seats, to choose how the firm pays (bank debit,
// card, or wire) and to see invoices. Opus Juris staff see every account and
// set each firm's terms from the same page.
// Sign in is the firm code and admin email plus a one-time code emailed
// to that address (Supabase Auth); everything else goes to the back end
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
  $("form-ref").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("signin-err").textContent = "";
    pending = { ref: $("ref").value.trim().toUpperCase(), email: $("email").value.trim().toLowerCase() };
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
    ref = pending.ref;
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
    for (const id of ["st-usage", "st-tokens", "st-seats", "st-next"]) { $(id).innerHTML = sk("72%"); $(id + "-s").innerHTML = sk("55%"); }
    $("month-total").innerHTML = sk("140px"); $("month-note").innerHTML = sk("220px"); $("usage-period").textContent = "";
    $("chart").innerHTML = '<span class="skel row" style="height:150px"></span>';
    $("cases").innerHTML = lines(4); $("people").innerHTML = lines(4); $("tokens-warn").textContent = "";
    $("plan").className = ""; $("plan").innerHTML = lines(4);
    $("method-icon").innerHTML = ""; $("method").innerHTML = sk("160px"); $("method-note").innerHTML = sk("120px");
    $("add").textContent = ""; $("choices").innerHTML = lines(3); $("pay-note").textContent = "";
    $("invoices").className = ""; $("invoices").innerHTML = lines(2);
  }
  async function enter() {
    $("signin").classList.add("hidden");
    $("app").classList.remove("hidden");
    showFirm();
    if (!current) skeleton();
    // Coming back from Stripe: ?setup=cs_... when something was added, ?setup=cancel when it was not.
    const q = new URLSearchParams(location.search).get("setup");
    if (q) history.replaceState(null, "", location.pathname);
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
    const wantOwner = j.is_owner && location.hash === "#accounts";
    $("owner-btn").classList.toggle("hidden", !wantOwner);
    if (wantOwner && $("main-owner").classList.contains("hidden")) showOwner();
    const st = $("status");
    const standing = !p ? ["No plan", ""] : sub && sub.status === "past_due" ? ["Past due", "past_due"] : sub && sub.status === "unpaid" ? ["Unpaid", "unpaid"] : ["Active", "active"];
    st.textContent = standing[0]; st.className = "tag " + standing[1];
    // usage: the period, the total at the firm's rate, by day, by case, by person
    const mo = u.month, tk = u.tokens, s = u.seats;
    const onTokens = tk && tk.left !== null && tk.left !== undefined;
    const since = mo && mo.on_tokens && mo.window_start ? String(mo.window_start).slice(0, 10) : null;
    const periodText = since ? "since " + dateText(since) : "this month";
    $("usage-title").textContent = "Usage";
    $("usage-period").textContent = periodText.replace(/^./, (c) => c.toUpperCase());
    const total = mo && mo.total_usd != null ? Number(mo.total_usd) : null;
    $("st-usage-k").textContent = "Usage " + periodText;
    $("st-usage").textContent = total != null ? usd(total) : (onTokens ? tokens(tk.used) + " tokens" : "n/a");
    $("st-usage-s").textContent = mo && mo.days_left != null && !since ? mo.days_left + " days left" : (mo && mo.usage_rate != null && Number(mo.usage_rate) !== 1 ? "At the firm\u2019s rate" : "");
    $("month-total").textContent = total != null ? usd(total) : "";
    $("month-note").textContent = total != null ? (onTokens ? tokens(tk.used) + " tokens used " + periodText + (Number(mo.usage_rate) !== 1 ? ", at the firm\u2019s rate" : "") : "At the firm\u2019s rate") : "No usage recorded yet.";
    $("st-tokens").textContent = onTokens ? tokens(tk.left) : "n/a";
    $("st-tokens-s").textContent = onTokens ? "of " + tokens(tk.granted) + " granted" : "Not on tokens";
    $("st-seats").textContent = s ? String(s.used) : "n/a";
    $("st-seats-s").textContent = s && s.seats ? "of " + s.seats + " included" : "in use";
    renderChart((mo && mo.by_day) || []);
    const base = total || 0;
    const pct = (v) => (base > 0 ? '<span class="pct">' + Math.round(Number(v) / base * 100) + "%</span>" : "");
    const cases = (mo && mo.by_case) || [];
    $("cases").innerHTML = cases.length ? cases.slice(0, 6).map((c) => "<div><span>" + esc(c.case_ref === "other" ? "Other work" : "Case " + c.case_ref) + "</span><b>" + esc(usd(c.usd)) + pct(c.usd) + "</b></div>").join("") : '<div><span class="empty">Nothing yet</span></div>';
    const people = (mo && mo.by_user) || [];
    $("people").innerHTML = people.length ? people.slice(0, 6).map((x) => "<div><span>" + esc(x.name || x.email) + "</span><b>" + esc(usd(x.usd)) + pct(x.usd) + "</b></div>").join("") : '<div><span class="empty">Nothing yet</span></div>';
    $("tokens-warn").textContent = onTokens && Number(tk.left) <= 0 ? "No tokens left: drafting, analysis and chat are paused until more tokens are added." : "";
    // next payment
    const price = p ? (p.discounted ? p.bank_monthly_usd : p.monthly_usd) : null;
    const today = new Date().toISOString().slice(0, 10);
    if (!p) { $("st-next").textContent = "None"; $("st-next-s").textContent = "No plan on this account"; }
    else if (sub && sub.current_period_end) { $("st-next").textContent = usd(price); $("st-next-s").textContent = (sub.cancel_at_period_end ? "Final, " : "Due ") + day(sub.current_period_end); }
    else if (p.starts_on > today) { $("st-next").textContent = usd(price); $("st-next-s").textContent = "First payment " + dateText(p.starts_on); }
    else { $("st-next").textContent = usd(price); $("st-next-s").textContent = "Each month"; }
    // the subscription card
    const ss = $("sub-status");
    if (sub) { ss.textContent = label(sub.status); ss.className = "tag " + esc(sub.status); } else { ss.textContent = p ? "Not started" : ""; ss.className = "tag"; }
    renderPlan(j, sub, price);
    // billing: the method on file and the ways to pay
    const mt = methodText(m, pay);
    $("method-icon").innerHTML = mt.icon;
    $("method").textContent = mt.long;
    $("method-note").textContent = mt.note;
    $("add").textContent = m ? "Change" : "";
    renderChoices(j, pay);
    $("pay-note").textContent = p ? "Bank payment, by debit or wire, is " + String(p.bank_discount_pct).replace(/\.0$/, "") + "% below the card price. Details are entered on Stripe\u2019s secure page and never stored by Opus Juris." : "Card and bank details are entered on Stripe\u2019s secure page and never stored by Opus Juris.";
    // invoices
    const inv = j.invoices || [];
    $("invoices").className = inv.length ? "" : "empty";
    $("invoices").innerHTML = inv.length ? '<table><thead><tr><th>Invoice</th><th class="hide-sm">Date</th><th>Status</th><th class="num">Amount</th><th class="num"></th></tr></thead><tbody>' + inv.map((i) => {
      const amt = i.status === "paid" ? i.amount_paid : i.amount_due;
      const act = i.status === "open" && i.hosted_invoice_url ? '<a class="btn sm" href="' + esc(i.hosted_invoice_url) + '" target="_blank" rel="noopener">Pay</a>' : (i.invoice_pdf ? '<a class="link" href="' + esc(i.invoice_pdf) + '" target="_blank" rel="noopener">PDF</a>' : "");
      return "<tr><td>" + esc(i.number || "Invoice") + '</td><td class="hide-sm">' + esc(day(i.created)) + '</td><td><span class="tag ' + esc(i.status) + '">' + esc(label(i.status)) + '</span></td><td class="num">' + esc(money(amt, i.currency)) + '</td><td class="num">' + act + "</td></tr>";
    }).join("") + "</tbody></table>" : (p ? "Your first invoice appears here on " + dateText(p.starts_on) + "." : "No invoices yet.");
  }
  // Daily usage over the last 30 days as plain bars.
  function renderChart(days) {
    const el = $("chart");
    const byDay = {};
    days.forEach((d) => { byDay[String(d.day).slice(0, 10)] = Number(d.usd) || 0; });
    const list = [];
    for (let k = 29; k >= 0; k--) { const d = new Date(); d.setDate(d.getDate() - k); const key = d.toISOString().slice(0, 10); list.push({ key, v: byDay[key] || 0 }); }
    const max = Math.max(1, ...list.map((x) => x.v));
    const W = 600, H = 150, pad = 2, bw = W / list.length;
    const bars = list.map((x, i) => { const h = Math.round((x.v / max) * (H - 18)); return '<rect x="' + (i * bw + pad).toFixed(1) + '" y="' + (H - h) + '" width="' + (bw - pad * 2).toFixed(1) + '" height="' + h + '" rx="2" fill="' + (x.v ? "#2563eb" : "#e2e8f0") + '"><title>' + esc(dateText(x.key)) + ": " + esc(usd(x.v)) + "</title></rect>"; }).join("");
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-label="Usage by day">' + bars + "</svg>"
      + '<div class="axis"><span>' + esc(dateText(list[0].key)) + "</span><span>Peak " + esc(usd(max === 1 && !list.some((x) => x.v) ? 0 : max)) + " a day</span><span>" + esc(dateText(list[list.length - 1].key)) + "</span></div>";
  }
  // One description of the way the firm pays, used by the tile and the card.
  const ICON_CARD = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>';
  const ICON_BANK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18"/><path d="M12 3l9 7H3l9-7z"/><path d="M5 10v8M10 10v8M14 10v8M19 10v8"/><path d="M3 21h18"/></svg>';
  const ICON_WIRE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M14 6l6 6-6 6"/></svg>';
  function methodText(m, pay) {
    if (pay === "wire") return { short: "Wire", sub: "Invoiced by email", long: "Paying by wire", note: "Each invoice arrives by email with wire instructions.", icon: ICON_WIRE };
    if (!m) return { short: "None", sub: "Add one to pay automatically", long: "No payment method on file", note: "Choose a way to pay below.", icon: ICON_CARD };
    if (m.type === "card") return { short: label(m.brand).replace(/^./, (c) => c.toUpperCase()) + " \u2022\u2022\u2022\u2022 " + m.last4, sub: m.exp_month ? "Expires " + String(m.exp_month).padStart(2, "0") + "/" + m.exp_year : "Card", long: label(m.brand).replace(/^./, (c) => c.toUpperCase()) + " card ending " + m.last4, note: m.exp_month ? "Expires " + String(m.exp_month).padStart(2, "0") + "/" + m.exp_year + ". Charged on each invoice." : "Charged on each invoice.", icon: ICON_CARD };
    if (m.type === "bank") return { short: "Bank \u2022\u2022\u2022\u2022 " + m.last4, sub: m.bank_name || "Bank debit", long: (m.bank_name || "Bank account") + " ending " + m.last4, note: "Bank debit (ACH), pulled on each invoice.", icon: ICON_BANK };
    return { short: "On file", sub: "", long: "Payment method on file", note: "", icon: ICON_CARD };
  }
  // The subscription card: the terms as agreed and what comes next.
  function renderPlan(j, sub, price) {
    const p = j.plan, el = $("plan");
    if (!p) { el.className = "empty"; el.textContent = "No plan on this account yet. Opus Juris sets the terms once your agreement is signed."; return; }
    el.className = "";
    const start = new Date(p.starts_on + "T00:00:00"), end = new Date(p.ends_on + "T00:00:00"), now = new Date();
    const frac = Math.max(0, Math.min(1, (now - start) / (end - start)));
    const rows = [["Monthly", usd(p.monthly_usd)], ["Term", p.term_months + (p.term_months === 1 ? " month" : " months")], ["Period", dateText(p.starts_on) + " to " + dateText(p.ends_on)]];
    if (sub && sub.current_period_end) rows.push([sub.cancel_at_period_end ? "Final payment" : "Next payment", usd(price) + " on " + day(sub.current_period_end)]);
    else if (now < start) rows.push(["First payment", usd(price) + " on " + dateText(p.starts_on)]);
    el.innerHTML = '<div class="kv">' + rows.map((r) => '<span class="k">' + esc(r[0]) + '</span><span class="v">' + esc(r[1]) + "</span>").join("") + "</div>"
      + '<div class="bar"><i style="width:' + Math.round(frac * 100) + '%"></i></div>';
  }
  // The ways to pay, as a plain list; the current one is marked.
  function renderChoices(j, pay) {
    const p = j.plan, m = j.method;
    const cur = pay === "wire" ? "wire" : (m && m.type === "bank") ? "bank" : (m && m.type === "card") ? "card" : "";
    const price = (bank) => (p ? (bank ? usd(p.bank_monthly_usd) : usd(p.monthly_usd)) + " / month" : "");
    const opts = [
      { k: "bank", t: "Bank debit", s: "ACH, drawn on each invoice", e: price(true) },
      { k: "card", t: "Card", s: "Charged on each invoice", e: price(false) },
      { k: "wire", t: "Wire", s: "Invoiced by email, paid by wire", e: price(true) },
    ];
    $("choices").innerHTML = opts.map((o) => '<button type="button" class="payrow' + (cur === o.k ? " on" : "") + '" data-pay="' + o.k + '"><span class="radio"></span><b>' + esc(o.t) + (cur === o.k ? '<span class="cur">Current</span>' : "") + '</b><span class="d">' + esc(o.s) + "</span><em>" + esc(o.e) + "</em></button>").join("");
    const w = $("wire");
    if (pay === "wire") { w.classList.remove("hidden"); w.textContent = j.wire_instructions ? "Wire to: " + j.wire_instructions : "Wire instructions are printed on each invoice."; }
    else w.classList.add("hidden");
    $("choices").querySelectorAll(".payrow").forEach((b) => b.addEventListener("click", () => { if (b.dataset.pay !== cur) choose(b.dataset.pay); }));
  }
  async function choose(kind) {
    try {
      if (kind === "wire") { await call("choose-pay", { ref, pay_by: "wire" }, true); flash("ok", "You pay by wire. Each invoice arrives by email with the instructions."); await refresh(); return; }
      const j = await call("setup-session", { ref, kind }, true);
      location.href = j.url;
    } catch (err) { if (await expiredOut(err)) return; flash("bad", err.message); }
  }
  $("add").addEventListener("click", async () => {
    $("add").disabled = true;
    try { const j = await call("setup-session", { ref }, true); location.href = j.url; }
    catch (err) { $("add").disabled = false; if (await expiredOut(err)) return; flash("bad", err.message); }
  });

  // ── the owner's screen: every account and its terms ──
  function showFirm() { $("main-owner").classList.add("hidden"); $("main-firm").classList.remove("hidden"); $("owner-btn").classList.add("hidden"); if (location.hash === "#accounts") history.replaceState(null, "", location.pathname); }
  function showOwner() { $("main-firm").classList.add("hidden"); $("main-owner").classList.remove("hidden"); $("owner-btn").textContent = "My account"; $("owner-btn").classList.remove("hidden"); loadAccounts(); }
  $("owner-btn").addEventListener("click", () => showFirm());
  window.addEventListener("hashchange", () => { if (current && current.is_owner && location.hash === "#accounts") showOwner(); });
  function oflash(kind, text) { const f = $("owner-flash"); f.className = "banner " + (text ? kind : "hidden"); f.textContent = text || ""; }
  async function loadAccounts() {
    oflash("", "");
    try {
      const j = await call("admin/accounts", {}, true);
      const rows = j.accounts || [];
      $("owner-list").className = rows.length ? "acct-list" : "empty";
      $("owner-list").innerHTML = rows.length ? '<table><thead><tr><th>Firm</th><th>Firm code</th><th class="hide-sm">Administrator</th><th class="num">Monthly</th><th class="hide-sm">Term</th><th>Pays by</th><th></th></tr></thead><tbody>' + rows.map((a) =>
        '<tr data-ref="' + esc(a.ref_no) + '"><td><b>' + esc(a.firm_name) + "</b>" + (a.active ? "" : ' <span class="tag">Inactive</span>') + "</td><td>" + esc(a.ref_no) + '</td><td class="hide-sm">' + esc(a.admin_email) + '</td><td class="num">' + (a.monthly_usd != null ? esc(usd(a.monthly_usd)) : "") + '</td><td class="hide-sm">' + (a.term_months ? esc(a.term_months + " mo from " + dateText(a.starts_on)) : "") + "</td><td>" + (a.pay_by === "wire" ? "Wire" : "Saved method") + '</td><td class="act"><span class="link">Edit</span></td></tr>').join("") + "</tbody></table>" : "No accounts yet.";
      $("owner-list").querySelectorAll("tr[data-ref]").forEach((tr) => tr.addEventListener("click", () => edit(rows.find((a) => a.ref_no === tr.dataset.ref))));
    } catch (err) { if (await expiredOut(err)) return; oflash("bad", err.message); }
  }
  function edit(a) {
    const f = $("owner-form");
    $("owner-edit").classList.remove("hidden");
    $("owner-edit-title").textContent = a ? a.firm_name : "New account";
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
      oflash(j.warning ? "warn" : "ok", j.warning || ("Saved " + (j.account ? j.account.firm_name : "") + "."));
      $("owner-edit").classList.add("hidden");
      await loadAccounts();
      if (j.account && j.account.ref_no === ref) { try { await refresh(); } catch (_) { /* shown on the next visit */ } }
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
