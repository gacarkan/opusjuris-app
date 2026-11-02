// The vendor project the portal signs in against (Supabase Auth: the anon key
// is public by design) and the back end it talks to (Python on PythonAnywhere;
// see the opusjuris-backend repo). Put the PythonAnywhere address in apiBase
// once the web app is up, with no trailing slash.
window.BILLING_CONFIG = {
  supabaseUrl: "https://zmoxcoasqqozqkopbbrk.supabase.co",
  supabaseAnonKey: "sb_publishable_rCs8IxBdEs9J5vjBuv-dMw_16WjHFsc",
  apiBase: "https://opusjuris.pythonanywhere.com",
};
