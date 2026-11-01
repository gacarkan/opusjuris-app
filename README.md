# Opus Juris Accounts portal

Where a firm's administrator signs in to see their billing and add a card or
bank account (ACH). One static page, no build, published to GitHub Pages from
`main` at pay.opusjuris.com.

- `index.html`, `app.js`: the page. `config.js`: the vendor project's public URL
  and anon key (public by design).
- Sign in: Account Ref No + admin email, then a one-time code emailed to that
  address. The code is checked by Supabase Auth; the `billing` function then
  checks that the signed-in email is the admin email of that account.
- Card and bank numbers are entered on a Stripe Checkout page and never reach
  this site or our database. Only Stripe's customer id is stored.

The back end lives in the app repo: `supabase/migrations/206_accounts_portal.sql`
(the `portal_accounts` table) and `supabase/functions/billing`.

## Go live, in order

1. **Stripe.** Create the account. Turn on ACH Direct Debit under Settings,
   Payment methods. Start in test mode: use the `sk_test_` secret key.
2. **Vendor Supabase project.** Run migration 206. Set the function secrets
   (`supabase secrets set STRIPE_SECRET_KEY=sk_test_... BILLING_PORTAL_URL=https://pay.opusjuris.com`)
   and deploy: `supabase functions deploy billing --project-ref <ref> --no-verify-jwt`.
3. **The sign-in email.** Auth must email a code, not a link: in the project's
   Auth, Email templates, Magic Link, put `{{ .Token }}` in the body (for
   example "Your Opus Juris Accounts code is {{ .Token }}"). The built-in
   mailer is limited to a few emails an hour, so set a custom SMTP sender
   (Resend, Postmark, Google Workspace) under Auth, SMTP settings.
4. **This site.** Create a GitHub repo, push `main` (the workflow publishes it),
   set the custom domain in the repo's Pages settings, and add a CNAME record
   at GoDaddy: `pay` pointing to `<your-github-user>.github.io`.
5. **First account.** Insert a row in `portal_accounts` (see the migration), sign
   in, add a test card (4242 4242 4242 4242), then create a subscription or an
   invoice for that customer in Stripe and watch it show here.
6. **Live.** Swap in the `sk_live_` key and repeat step 5 with a real card.

## Billing in Stripe

We create subscriptions and invoices in the Stripe dashboard. A subscription or
invoice with "charge automatically" collection uses the payment method the
firm saved here. The portal shows the subscription, the invoices, and a Pay
button on any open invoice.
