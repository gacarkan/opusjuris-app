# Opus Juris Accounts portal

Where a firm's administrator signs in to see the firm's usage, tokens and
seats, and to manage billing (a card or bank account, invoices). One static
page, no build, published to GitHub Pages from `main` at app.opusjuris.com.
The Sign in link on www.opusjuris.com points here.

- `index.html`, `app.js`: the page. `config.js`: the vendor project's public URL
  and anon key (public by design) and `apiBase`, the back end's address.
- Sign in: Account Ref No + admin email, then a one-time code emailed to that
  address. The code is checked by Supabase Auth; the back end then checks that
  the signed-in email is the admin email of that account.
- The back end is Python on PythonAnywhere: the `opusjuris-backend` repo
  (Flask, `/api/...`). The database stays Supabase: the vendor project holds
  the accounts (`portal_accounts`, migration 206 in the app repo); each firm's
  own project answers for its usage, tokens and seats.
- Card and bank numbers are entered on a Stripe Checkout page and never reach
  this site, the back end or the database. Only Stripe's customer id is stored.

## Go live, in order

1. **Back end.** Follow the README in `opusjuris-backend` (PythonAnywhere web
   app, `.env`, reload). Put its address in `config.js` as `apiBase`.
2. **Vendor Supabase project.** Run migration 206 (the accounts table) and
   create the first account by hand (the INSERT in the migration's header).
   Auth must email a code, not a link: Authentication, Email Templates, Magic
   Link, `{{ .Token }}` in the body.
3. **This page.** Push `main`. In the repo's Settings, Pages: source `main`,
   custom domain `app.opusjuris.com` (the CNAME file sets it), enforce HTTPS
   once the certificate is issued.
4. **DNS at GoDaddy.** A CNAME record: host `app`, value `gacarkan.github.io`.
5. **Stripe.** Test mode first (`sk_test_` in the back end's `.env`), then the
   live key.
