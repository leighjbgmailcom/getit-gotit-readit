// =====================================================================
// GetIt GotIt ReadIt — Author bibliography lookup + bulk "Get It" add
// =====================================================================
// Lets a user search Open Library for an author, then bulk-add that
// author's published works as "Get It" in one go — instead of looking
// up a bibliography on another site and entering each book by hand.
// =====================================================================

/**
 * Search Open Library for authors matching a name.
 * @returns {Promise<Array<{key, name, birthDate, topWork, workCount}>>}
 */
async function searchOpenLibraryAuthors(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return [];

  const params = new URLSearchParams();
  params.set("q", trimmed);
  params.set("limit", "10");

  try {
    const res = await fetch(`${OPEN_LIBRARY_BASE}/search/authors.json?${params.toString()}`);
    if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
    const data = await res.json();
    const docs = Array.isArray(data.docs) ? data.docs : [];
    return docs
      .filter((doc) => doc.key)
      .map((doc) => ({
        key: doc.key, // e.g. "OL123A"
        name: doc.name || "Unknown author",
        birthDate: doc.birth_date || null,
        topWork: doc.top_work || null,
        workCount: doc.work_count || 0,
      }));
  } catch (err) {
    console.error("Author search failed:", err);
    return [];
  }
}

/**
 * Fetch (almost) all of an author's published works from Open Library,
 * paging past the API's default page size since some authors have
 * hundreds of entries. Filters out entries with no title.
 *
 * @param {string} authorKey - e.g. "OL123A"
 * @param {number} maxWorks - safety cap on how many to fetch
 * @returns {Promise<Array<{openlibrary_work_id, title, first_publish_year, cover_url}>>}
 */
async function getAuthorWorks(authorKey, maxWorks = 500) {
  const works = [];
  const seen = new Set();
  const pageSize = 100;
  let offset = 0;

  while (works.length < maxWorks) {
    const params = new URLSearchParams();
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));

    let data;
    try {
      const res = await fetch(`${OPEN_LIBRARY_BASE}/authors/${authorKey}/works.json?${params.toString()}`);
      if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
      data = await res.json();
    } catch (err) {
      console.error("Failed to load author works:", err);
      break;
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (entries.length === 0) break;

    for (const entry of entries) {
      if (!entry.key || !entry.title) continue;
      const workId = entry.key.replace("/works/", "");
      if (seen.has(workId)) continue;
      seen.add(workId);

      const coverId = Array.isArray(entry.covers) ? entry.covers.find((c) => c > 0) : null;

      works.push({
        openlibrary_work_id: workId,
        title: entry.title,
        first_publish_year: entry.first_publish_date ? parseYear(entry.first_publish_date) : null,
        cover_url: coverId ? `${OPEN_LIBRARY_COVERS_BASE}/b/id/${coverId}-M.jpg` : null,
      });
    }

    offset += pageSize;
    if (entries.length < pageSize) break; // last page
  }

  // Sort oldest-first so a "bibliography" reads naturally; unknown
  // years sort to the end rather than the beginning.
  works.sort((a, b) => {
    if (a.first_publish_year == null && b.first_publish_year == null) return a.title.localeCompare(b.title);
    if (a.first_publish_year == null) return 1;
    if (b.first_publish_year == null) return -1;
    return a.first_publish_year - b.first_publish_year;
  });

  return works.slice(0, maxWorks);
}

function parseYear(dateStr) {
  const match = /\d{4}/.exec(dateStr || "");
  return match ? Number(match[0]) : null;
}

/**
 * Bulk-add a set of works as "want" (Get It) status for the current
 * user, using the same chunked cache-then-status-upsert pattern as the
 * CSV importer (js/import.js).
 *
 * @param {Array} works - objects with openlibrary_work_id/title/first_publish_year/cover_url
 * @param {(msg: string) => void} onProgress
 * @returns {Promise<{added: number}>}
 */
async function bulkAddWorksAsWant(works, onProgress) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Setup incomplete. Please try again later.");

  const user = await getCurrentUser();
  if (!user) throw new Error("Please log in first.");

  if (!works || works.length === 0) return { added: 0 };

  onProgress(`Caching ${works.length} book${works.length === 1 ? "" : "s"}…`);

  const bookChunks = chunkArray(
    works.map((w) => ({
      openlibrary_work_id: w.openlibrary_work_id,
      title: w.title,
      author: w.author || null,
      first_publish_year: w.first_publish_year,
      cover_url: w.cover_url,
    })),
    200
  );

  const workIdToBookId = new Map();
  for (let i = 0; i < bookChunks.length; i++) {
    onProgress(`Caching books… batch ${i + 1} of ${bookChunks.length}`);
    const { data, error } = await client
      .from("books")
      .upsert(bookChunks[i], { onConflict: "openlibrary_work_id" })
      .select("id, openlibrary_work_id");
    if (error) {
      console.error("Bulk add: failed to cache a batch of books:", error);
      throw new Error("Something went wrong saving books. Please try again.");
    }
    for (const row of data) workIdToBookId.set(row.openlibrary_work_id, row.id);
  }

  onProgress("Adding to your Get It list…");

  const statusRows = works
    .map((w) => ({
      user_id: user.id,
      book_id: workIdToBookId.get(w.openlibrary_work_id),
      status: "want",
    }))
    .filter((r) => r.book_id);

  const statusChunks = chunkArray(statusRows, 200);
  let added = 0;
  for (let i = 0; i < statusChunks.length; i++) {
    onProgress(`Adding to your Get It list… batch ${i + 1} of ${statusChunks.length}`);
    const { error } = await client
      .from("user_books")
      .upsert(statusChunks[i], { onConflict: "user_id,book_id" });
    if (error) {
      console.error("Bulk add: failed to set a batch of statuses:", error);
      throw new Error("Books were cached, but something went wrong adding them to your list. Please try again.");
    }
    added += statusChunks[i].length;
  }

  return { added };
}
