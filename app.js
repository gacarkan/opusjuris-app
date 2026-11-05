// Opus Juris Accounts: the page a firm's administrator uses to see the firm's
// usage, tokens and seats, their billing, and to add a card or bank account.
// Sign in is the Account Ref No and admin email plus a one-time code emailed
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
  const day = (secs) => (secs ? new Date(secs * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");
  const label = (s) => String(s || "").replace(/_/g, " ");
  const REF_KEY = "oj-account-ref";
  let ref = "", pending = { ref: "", email: "" };
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
      $("code").value = "";
      $("code").focus();
    } catch (err) { $("signin-err").textContent = err.message; }
    $("send").disabled = false;
  });
  $("form-code").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("signin-err").textContent = "";
    $("verify").disabled = true;
    const { data, error } = await sb.auth.verifyOtp({ email: pending.email, token: $("code").value.replace(/\s+/g, ""), type: "email" });
    $("verify").disabled = false;
    if (error || !data || !data.session) { $("signin-err").textContent = "That code is wrong or has expired. Check it, or start over for a new one."; return; }
    ref = pending.ref;
    setRef(ref);
    enter();
  });
  $("back").addEventListener("click", () => showSignin(""));
  $("signout").addEventListener("click", async () => { await sb.auth.signOut(); setRef(""); location.href = location.pathname; });

  // ── the account ──
  function flash(kind, text) { const f = $("flash"); f.className = "banner " + kind; f.textContent = text; }
  async function enter() {
    $("signin").classList.add("hidden");
    $("app").classList.remove("hidden");
    // Coming back from Stripe: ?setup=cs_... when something was added, ?setup=cancel when it was not.
    const q = new URLSearchParams(location.search).get("setup");
    if (q) history.replaceState(null, "", location.pathname);
    try {
      if (q && /^cs_/.test(q)) {
        try { await call("complete-setup", { ref, session_id: q }, true); flash("ok", "Your payment method was saved."); }
        catch (err) { if (err.message === "expired") throw err; flash("bad", err.message); }
      } else if (q === "cancel") flash("warn", "Nothing was changed.");
      const j = await call("overview", { ref }, true);
      render(j);
    } catch (err) {
      if (err.message === "expired") { await sb.auth.signOut(); return showSignin("Please sign in again."); }
      flash("bad", err.message);
    }
  }
  function render(j) {
    const a = j.account;
    $("me").textContent = a.admin_email;
    $("firm").textContent = a.firm_name;
    $("refline").textContent = "Account number " + a.ref_no;
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
    $("plan").textContent = lic ? (String(lic.plan || "").replace(/^./, (c) => c.toUpperCase()) + (lic.status && lic.status !== "active" ? " (" + lic.status + ")" : "") + (lic.expires_at ? ", renews " + new Date(lic.expires_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "")) : "";
    const m = j.method;
    if (!m) { $("method").textContent = "No payment method on file"; $("method-note").textContent = "Add a card or bank account so your invoices can be paid."; $("add").textContent = "Add card or bank account"; }
    else {
      $("method").textContent = m.type === "card" ? (label(m.brand).replace(/^./, (c) => c.toUpperCase()) + " card ending " + m.last4) : m.type === "bank" ? ((m.bank_name || "Bank account") + " ending " + m.last4) : "Payment method on file";
      $("method-note").textContent = m.type === "card" && m.exp_month ? "Expires " + String(m.exp_month).padStart(2, "0") + "/" + m.exp_year : m.type === "bank" ? "ACH bank debit" : "";
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
  $("add").addEventListener("click", async () => {
    $("add").disabled = true;
    try { const j = await call("setup-session", { ref }, true); location.href = j.url; }
    catch (err) { $("add").disabled = false; if (err.message === "expired") { await sb.auth.signOut(); return showSignin("Please sign in again."); } flash("bad", err.message); }
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
