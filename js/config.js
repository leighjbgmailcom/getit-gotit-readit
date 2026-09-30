// =====================================================================
// GetIt GotIt ReadIt — Configuration
// =====================================================================
// >>> PUT YOUR SUPABASE CREDENTIALS HERE <<<
//
// Where to find them:
//   Supabase Dashboard -> your project -> Project Settings -> API
//     - "Project URL"       -> SUPABASE_URL
//     - "anon" "public" key -> SUPABASE_ANON_KEY
//
// IMPORTANT: only ever use the anon/public key here. Never paste the
// service_role key into any file that ships to the browser — that key
// bypasses Row Level Security and must stay server-side only (this
// app has no server, so it should never appear anywhere in this repo).
// =====================================================================

const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

// After login/signup, users are sent here.
const POST_LOGIN_REDIRECT = "my-books.html";

// Open Library API base (no key required — it's a free public API).
const OPEN_LIBRARY_BASE = "https://openlibrary.org";
const OPEN_LIBRARY_COVERS_BASE = "https://covers.openlibrary.org";
