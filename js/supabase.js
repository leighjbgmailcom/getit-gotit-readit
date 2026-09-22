// =====================================================================
// GetIt GotIt ReadIt — Supabase client bootstrap
// =====================================================================
// Loads the Supabase JS SDK from a CDN (no build step needed for
// GitHub Pages) and creates a single shared client using the
// credentials from config.js.
// =====================================================================

let supabaseClient = null;

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  if (
    typeof SUPABASE_URL === "undefined" ||
    typeof SUPABASE_ANON_KEY === "undefined" ||
    SUPABASE_URL === "YOUR_SUPABASE_URL" ||
    SUPABASE_ANON_KEY === "YOUR_SUPABASE_ANON_KEY"
  ) {
    console.error(
      "GetIt GotIt ReadIt: Supabase credentials are not configured. " +
        "Edit js/config.js and add your Project URL and anon key."
    );
    showConfigWarning();
    return null;
  }

  if (typeof window.supabase === "undefined") {
    console.error("Supabase SDK failed to load from CDN.");
    return null;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

function showConfigWarning() {
  const existing = document.getElementById("config-warning-banner");
  if (existing) return;
  const banner = document.createElement("div");
  banner.id = "config-warning-banner";
  banner.style.cssText =
    "background:#a3423a;color:#fff;padding:10px 16px;text-align:center;font-family:sans-serif;font-size:0.85rem;";
  banner.textContent =
    "Setup needed: add your Supabase URL and anon key to js/config.js to enable accounts and saving books.";
  document.body.prepend(banner);
}
