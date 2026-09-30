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

const SUPABASE_URL = "https://ahzrrcpgxievpqydturc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoenJyY3BneGlldnBxeWR0dXJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMzE3NzksImV4cCI6MjEwNTYwNzc3OX0.pIwFqrccMAhPOI-V0seV3VJ4oO5Ww5r6jrce611zVdE";

// After login/signup, users are sent here.
const POST_LOGIN_REDIRECT = "my-books.html";

// Open Library API base (no key required — it's a free public API).
const OPEN_LIBRARY_BASE = "https://openlibrary.org";
const OPEN_LIBRARY_COVERS_BASE = "https://covers.openlibrary.org";
