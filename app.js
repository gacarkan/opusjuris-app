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
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const API = String(cfg.apiBase || "").replace(/\/+$/, "");
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const money = (cents, cur) => new Intl.NumberFormat("en-US", { style: "currency", currency: (cur || "usd").toUpperCase() }).format((cents || 0) / 100);
  const usd = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(n) || 0);
  const day = (secs) => (secs ? new Date(secs * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");
  const dateText = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");
  const label = (s) => String(s || "").replace(/_/g, " ");
  const REF_KEY = "oj-account-ref";
  let ref = "", pending = { ref: "", email: "" }, current = null;
  const getRef = () => { try { return sessionStorage.getItem(REF_KEY) || ""; } catch (e) { return ""; } };
  const setRef = (v) => { try { v ? sessionStorage.setItem(REF_KEY, v) : sessionStorage.removeItem(REF_KEY); } catch (e) { /* private mode: the ref is asked for again */ } };

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
    await sb.auth.signOut();
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
  $("signout").addEventListener("click", async () => { await sb.auth.signOut(); setRef(""); location.href = location.pathname; });

  // ── the account ──
  function flash(kind, text) { const f = $("flash"); f.className = "banner " + kind; f.textContent = text; }
  async function enter() {
    $("signin").classList.add("hidden");
    $("app").classList.remove("hidden");
    showFirm();
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
    const a = j.account;
    $("me").textContent = a.admin_email;
    $("firm").textContent = a.firm_name;
    $("refline").textContent = "Firm code " + a.ref_no;
    $("owner-btn").classList.toggle("hidden", !j.is_owner);
    renderPlan(j);
    renderChoices(j);
    // Usage: tokens left, seats, what the firm is charged for (the back end
    // leaves out what it cannot read; nothing is invented here).
    const u = j.usage || {};
    const t = u.tokens, s = u.seats;
    const onTokens = t && t.left !== null && t.left !== undefined;
    $("tokens-left").textContent = onTokens ? tokens(t.left) : "";
    $("tokens-note").textContent = onTokens ? "tokens left of " + tokens(t.granted) + " (" + tokens(t.used) + " used; a token is $" + tokens(t.token_usd) + " of usage)" : "This account is not on tokens yet.";
    $("tokens-warn").textContent = onTokens && Number(t.left) <= 0 ? "No tokens left: drafting, analysis and chat are paused until more tokens are added." : "";
    $("seats").textContent = s && s.seats ? String(s.used) + " of " + String(s.seats) : (s ? String(s.used) + " in use" : "");
    const lic = u.license;
    $("lic-plan").textContent = lic ? (String(lic.plan || "").replace(/^./, (c) => c.toUpperCase()) + (lic.status && lic.status !== "active" ? " (" + lic.status + ")" : "")) : "";
    const m = j.method;
    if (!m) { $("method").textContent = "No payment method on file"; $("method-note").textContent = j.plan && j.plan.pay_by === "wire" ? "You pay by wire; invoices come by email." : "Choose a way to pay above."; $("add").textContent = "Add card or bank account"; }
    else {
      $("method").textContent = m.type === "card" ? (label(m.brand).replace(/^./, (c) => c.toUpperCase()) + " card ending " + m.last4) : m.type === "bank" ? ((m.bank_name || "Bank account") + " ending " + m.last4) : "Payment method on file";
      $("method-note").textContent = m.type === "card" && m.exp_month ? "Expires " + String(m.exp_month).padStart(2, "0") + "/" + m.exp_year : m.type === "bank" ? "Bank debit (ACH)" : "";
      $("add").textContent = "Change payment method";
    }
    const subs = j.subscriptions || [];
    $("subs").innerHTML = subs.length ? subs.map((s) => {
      const per = s.amount != null ? money(s.amount * (s.quantity || 1), s.currency) + (s.interval ? " per " + esc(s.interval) : "") : "";
      const next = s.current_period_end ? (s.cancel_at_period_end ? "Ends " : "Renews ") + day(s.current_period_end) : "";
      return '<div class="row" style="padding:4px 0"><div><b>' + esc(per) + '</b><div class="sub">' + esc(next) + '</div></div><span class="tag ' + esc(s.status) + '">' + esc(label(s.status)) + "</span></div>";
    }).join("") : "No subscription yet. Your invoices appear below.";
    const inv = j.invoices || [];
    $("invoices").innerHTML = inv.length ? '<table><thead><tr><th>Invoice</th><th class="hide-sm">Date</th><th>Status</th><th class="num">Amount</th><th class="num"></th></tr></thead><tbody>' + inv.map((i) => {
      const amt = i.status === "paid" ? i.amount_paid : i.amount_due;
      const act = i.status === "open" && i.hosted_invoice_url ? '<a class="btn" href="' + esc(i.hosted_invoice_url) + '" target="_blank" rel="noopener">Pay</a>' : (i.invoice_pdf ? '<a class="link" href="' + esc(i.invoice_pdf) + '" target="_blank" rel="noopener">PDF</a>' : "");
      return "<tr><td>" + esc(i.number || "Invoice") + '</td><td class="hide-sm">' + esc(day(i.created)) + '</td><td><span class="tag ' + esc(i.status) + '">' + esc(label(i.status)) + '</span></td><td class="num">' + esc(money(amt, i.currency)) + '</td><td class="num">' + act + "</td></tr>";
    }).join("") + "</tbody></table>" : "No invoices yet.";
  }
  // The firm's terms, as agreed: the monthly amount, for how long, from when.
  function renderPlan(j) {
    const p = j.plan;
    const el = $("plan");
    if (!p) { el.className = "empty"; el.textContent = "No plan on this account yet. Opus Juris sets the terms once your agreement is signed."; return; }
    el.className = "";
    el.innerHTML = '<div class="row"><div><div class="big">' + esc(usd(p.discounted ? p.bank_monthly_usd : p.monthly_usd)) + ' <span class="sub" style="font-size:1rem;font-weight:500">per month</span></div>'
      + '<div class="note">' + esc(String(p.term_months) + (p.term_months === 1 ? " month" : " months") + ", " + dateText(p.starts_on) + " to " + dateText(p.ends_on)) + "</div></div>"
      + '<div class="facts"><div><span class="k">Card price</span><b>' + esc(usd(p.monthly_usd)) + '</b></div><div><span class="k">Bank price</span><b>' + esc(usd(p.bank_monthly_usd)) + "</b></div></div></div>"
      + '<div class="note">Paying from a bank account, by debit through this page or by wire, is ' + esc(String(p.bank_discount_pct).replace(/\.0$/, "")) + "% less than paying by card.</div>";
  }
  // The three ways to pay, the current one marked.
  function renderChoices(j) {
    const p = j.plan, m = j.method, pay = (p && p.pay_by) || "auto";
    const cur = pay === "wire" ? "wire" : (m && m.type === "bank") ? "bank" : (m && m.type === "card") ? "card" : "";
    const price = (bank) => (p ? (bank ? usd(p.bank_monthly_usd) : usd(p.monthly_usd)) + " / month" : "");
    const opts = [
      { k: "bank", t: "Bank debit", s: "Pulled from your firm's bank account on each invoice. Lowest cost, nothing to do each month.", e: price(true), rec: true },
      { k: "card", t: "Card", s: "Charged to a saved card on each invoice.", e: price(false) },
      { k: "wire", t: "Wire", s: "Invoices come by email with wire instructions; you send each payment.", e: price(true) },
    ];
    $("choices").innerHTML = opts.map((o) => '<button type="button" class="choice' + (cur === o.k ? " on" : "") + '" data-pay="' + o.k + '"><b>' + esc(o.t) + (o.rec ? '<span class="tag active">Recommended</span>' : "") + (cur === o.k ? '<span class="tag">Current</span>' : "") + "</b><span>" + esc(o.s) + "</span><em>" + esc(o.e) + "</em></button>").join("");
    const w = $("wire");
    if (pay === "wire") { w.classList.remove("hidden"); w.textContent = j.wire_instructions ? "Wire to: " + j.wire_instructions : "Wire instructions are printed on each invoice."; }
    else w.classList.add("hidden");
    $("choices").querySelectorAll(".choice").forEach((b) => b.addEventListener("click", () => choose(b.dataset.pay)));
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
  function showFirm() { $("main-owner").classList.add("hidden"); $("main-firm").classList.remove("hidden"); $("owner-btn").textContent = "Accounts"; }
  function showOwner() { $("main-firm").classList.add("hidden"); $("main-owner").classList.remove("hidden"); $("owner-btn").textContent = "My account"; loadAccounts(); }
  $("owner-btn").addEventListener("click", () => { if ($("main-owner").classList.contains("hidden")) showOwner(); else showFirm(); });
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
    if (data && data.session) await sb.auth.signOut();
    showSignin("");
  })();
})();
