// The vendor project the portal signs in against (Supabase Auth: the anon key
// is public by design) and the back end it talks to (Python on PythonAnywhere;
// see the opusjuris-backend repo): the api.opusjuris.com web app on the
// acarkanlaw PythonAnywhere account, no trailing slash.
window.BILLING_CONFIG = {
  supabaseUrl: "https://zmoxcoasqqozqkopbbrk.supabase.co",
  supabaseAnonKey: "sb_publishable_rCs8IxBdEs9J5vjBuv-dMw_16WjHFsc",
  apiBase: "https://api.opusjuris.com",
  // Stripe's publishable key (public by design): with it, the card or bank
  // form opens inside the Billing page; without it, on Stripe's own page.
  stripePublishableKey: "pk_live_51UaMQQDQ70qpe7d73GBqfwV5hH28I5kIpLu5PH2cFwgbAgtssRucDWxzVfja5oiSbxkU2S1PLrzEaSC30P3tQ4Xi00noy9PcKG",
};
