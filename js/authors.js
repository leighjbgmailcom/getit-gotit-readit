// =====================================================================
// GetIt GotIt ReadIt — Author bibliography lookup + bulk "Get It" add
// =====================================================================
// Lets a user search Open Library for an author, then bulk-add that
// author's published works as "Get It" in one go — instead of looking
// up a bibliography on another site and entering each book by hand.
//
// Safety rules for the bulk add (see bulkAddWorksAsWant):
//   - A book already in the user's library is NEVER changed. Adding a
//     book you've already marked Read It or Got It leaves it as it was;
//     it does not get knocked back to Get It.
//   - A book already in the library under a different record (e.g. one
//     imported from a spreadsheet) is recognised by title + author and
//     skipped, so it isn't added a second time.
//   - Existing cached book details (cover, series, etc.) are never
//     overwritten by the bulk add.
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
 * Fetch an author's published works from Open Library.
 *
 * Uses Open Library's main search index (filtered to this author),
 * because — unlike the plain /authors/{key}/works listing — it tells
 * us which languages each work has been published in, which is what
 * makes the "English only" filter possible. If the search index comes
 * back empty for some reason, falls back to the plain works listing
 * (no language info) rather than showing nothing.
 *
 * Works whose titles are the same once normalized (Open Library often
 * has several records for one book) are collapsed into a single entry.
 *
 * @param {string} authorKey - e.g. "OL123A"
 * @param {number} maxWorks - safety cap on how many to fetch
 * @returns {Promise<{works: Array, hasLanguageInfo: boolean}>}
 *   each work: { openlibrary_work_id, title, first_publish_year, cover_url, languages: string[] }
 */
async function getAuthorWorks(authorKey, maxWorks = 500) {
  let works = await getAuthorWorksFromSearch(authorKey, maxWorks);
  let hasLanguageInfo = true;

  if (works.length === 0) {
    works = await getAuthorWorksFromListing(authorKey, maxWorks);
    hasLanguageInfo = false;
  }

  works = collapseDuplicateTitles(works);
  return { works: works.slice(0, maxWorks), hasLanguageInfo };
}

async function getAuthorWorksFromSearch(authorKey, maxWorks) {
  const works = [];
  const pageSize = 100;
  let page = 1;

  while (works.length < maxWorks) {
    const params = new URLSearchParams();
    params.set("q", `author_key:${authorKey}`);
    params.set("fields", "key,title,first_publish_year,cover_i,cover_edition_key,language");
    params.set("limit", String(pageSize));
    params.set("page", String(page));

    let data;
    try {
      const res = await fetch(`${OPEN_LIBRARY_BASE}/search.json?${params.toString()}`);
      if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
      data = await res.json();
    } catch (err) {
      console.error("Failed to load author works from search:", err);
      break;
    }

    const docs = Array.isArray(data.docs) ? data.docs : [];
    if (docs.length === 0) break;

    for (const doc of docs) {
      if (!doc.key || !doc.title) continue;
      const base = normalizeSearchDoc(doc); // api.js — same shape as Search results
      works.push({
        openlibrary_work_id: base.openlibrary_work_id,
        title: base.title,
        first_publish_year: base.first_publish_year,
        cover_url: base.cover_url,
        languages: Array.isArray(doc.language) ? doc.language : [],
      });
    }

    if (docs.length < pageSize) break; // last page
    page++;
  }
  return works;
}

async function getAuthorWorksFromListing(authorKey, maxWorks) {
  const works = [];
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
      const coverId = Array.isArray(entry.covers) ? entry.covers.find((c) => c > 0) : null;
      works.push({
        openlibrary_work_id: entry.key.replace("/works/", ""),
        title: entry.title,
        first_publish_year: entry.first_publish_date ? parseYear(entry.first_publish_date) : null,
        cover_url: coverId ? `${OPEN_LIBRARY_COVERS_BASE}/b/id/${coverId}-M.jpg` : null,
        languages: [],
      });
    }

    offset += pageSize;
    if (entries.length < pageSize) break; // last page
  }
  return works;
}

/**
 * Open Library frequently has two or three separate records for the
 * same book. Collapse entries whose titles match once normalized,
 * keeping the earliest publish year, the first cover found, and the
 * union of languages.
 */
function collapseDuplicateTitles(works) {
  const byTitle = new Map();
  const seenIds = new Set();

  for (const w of works) {
    if (seenIds.has(w.openlibrary_work_id)) continue;
    seenIds.add(w.openlibrary_work_id);

    const key = normalizeForMatch(w.title); // books.js
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, { ...w, languages: [...(w.languages || [])] });
      continue;
    }
    if (w.first_publish_year && (!existing.first_publish_year || w.first_publish_year < existing.first_publish_year)) {
      existing.first_publish_year = w.first_publish_year;
    }
    if (!existing.cover_url && w.cover_url) {
      existing.cover_url = w.cover_url;
      existing.openlibrary_work_id = w.openlibrary_work_id; // prefer the record that has a cover
    }
    for (const lang of w.languages || []) {
      if (!existing.languages.includes(lang)) existing.languages.push(lang);
    }
  }
  return Array.from(byTitle.values());
}

/**
 * Does this work have an English edition? Works Open Library has no
 * language info for at all are given the benefit of the doubt (they
 * are usually English records with incomplete data).
 */
function isEnglishWork(work) {
  return !work.languages || work.languages.length === 0 || work.languages.includes("eng");
}

function parseYear(dateStr) {
  const match = /\d{4}/.exec(dateStr || "");
  return match ? Number(match[0]) : null;
}

/**
 * Bulk-add a set of works as "want" (Get It) for the current user.
 *
 * Never changes anything already in the user's library:
 *   1. Works that match a library book by title + author are dropped
 *      up front (catches spreadsheet-imported books, which have a
 *      different id from the Open Library record).
 *   2. Book cache rows are inserted only if missing — existing rows
 *      (and their covers/series) are left untouched.
 *   3. Status rows are inserted only if missing — an existing Got It
 *      or Read It is never downgraded to Get It.
 *
 * @param {Array} works - objects with openlibrary_work_id/title/author/first_publish_year/cover_url
 * @param {(msg: string) => void} onProgress
 * @returns {Promise<{added: number, skipped: number}>}
 */
async function bulkAddWorksAsWant(works, onProgress) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Setup incomplete. Please try again later.");

  const user = await getCurrentUser();
  if (!user) throw new Error("Please log in first.");

  if (!works || works.length === 0) return { added: 0, skipped: 0 };

  // 1. Drop anything already in the library by title + author.
  onProgress("Checking your library for books you already have…");
  const library = await getMyLibraryForMatching();
  const candidates = works.map((w) => ({ ...w }));
  matchSearchResultsToLibrary(candidates, library); // books.js — sets myStatus on confirmed matches
  const libraryWorkIds = new Set(library.map((e) => e.workId).filter(Boolean));
  const toAdd = candidates.filter((w) => !w.myStatus && !libraryWorkIds.has(w.openlibrary_work_id));
  let skipped = works.length - toAdd.length;

  if (toAdd.length === 0) return { added: 0, skipped };

  // 2. Make sure each book has a cache row, without overwriting existing ones.
  onProgress(`Saving ${toAdd.length} book${toAdd.length === 1 ? "" : "s"}…`);
  const workIdToBookId = new Map();
  const bookChunks = chunkArray(toAdd, 200);

  for (let i = 0; i < bookChunks.length; i++) {
    onProgress(`Saving books… batch ${i + 1} of ${bookChunks.length}`);
    const rows = bookChunks[i].map((w) => ({
      openlibrary_work_id: w.openlibrary_work_id,
      title: w.title,
      author: w.author || null,
      first_publish_year: w.first_publish_year,
      cover_url: w.cover_url,
    }));

    const { error: insertError } = await client
      .from("books")
      .upsert(rows, { onConflict: "openlibrary_work_id", ignoreDuplicates: true });
    if (insertError) {
      console.error("Bulk add: failed to save a batch of books:", insertError);
      throw new Error("Something went wrong saving books. Please try again.");
    }

    // Look up ids for the whole batch — both newly inserted rows and
    // ones that already existed (which the insert above left alone).
    const { data: found, error: findError } = await client
      .from("books")
      .select("id, openlibrary_work_id")
      .in("openlibrary_work_id", rows.map((r) => r.openlibrary_work_id));
    if (findError) {
      console.error("Bulk add: failed to look up saved books:", findError);
      throw new Error("Something went wrong saving books. Please try again.");
    }
    for (const row of found) workIdToBookId.set(row.openlibrary_work_id, row.id);
  }

  // 3. Add Get It status only where the user has no status yet.
  onProgress("Adding to your Get It list…");
  const statusRows = toAdd
    .map((w) => ({ user_id: user.id, book_id: workIdToBookId.get(w.openlibrary_work_id), status: "want" }))
    .filter((r) => r.book_id);

  const statusChunks = chunkArray(statusRows, 200);
  let added = 0;
  for (let i = 0; i < statusChunks.length; i++) {
    onProgress(`Adding to your Get It list… batch ${i + 1} of ${statusChunks.length}`);
    const { data, error } = await client
      .from("user_books")
      .upsert(statusChunks[i], { onConflict: "user_id,book_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("Bulk add: failed to set a batch of statuses:", error);
      throw new Error("Books were saved, but something went wrong adding them to your list. Please try again.");
    }
    const insertedCount = Array.isArray(data) ? data.length : 0;
    added += insertedCount;
    skipped += statusChunks[i].length - insertedCount;
  }

  return { added, skipped };
}
