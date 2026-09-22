// =====================================================================
// GetIt GotIt ReadIt — Book + user_books data layer
// =====================================================================
// Bridges Open Library data (api.js) with our Supabase cache (`books`)
// and each user's personal tracking (`user_books`).
// =====================================================================

/** Small deterministic string hash (djb2), used to build stable synthetic ids. */
function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Build the same stable synthetic "openlibrary_work_id" the CSV importer
 * (js/import.js) uses for a book that didn't come from a live Open
 * Library lookup. Also used by search.html to recognize an imported
 * book in live search results, which only carry the *real* Open
 * Library work id — imported books need to be matched by this
 * title+author formula instead, since they were never looked up live.
 */
function makeImportWorkId(author, title) {
  const norm = `${(author || "").trim().toLowerCase()}|${(title || "").trim().toLowerCase()}`;
  const slug = norm
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `csv-${slug}-${stableHash(norm)}`;
}

/**
 * Get the local `books` cache row for an Open Library work, creating
 * it if this is the first time anyone on GetIt GotIt ReadIt has
 * touched this book. Never bulk-imports — only ever one row at a time,
 * on demand.
 *
 * @param {object} bookData - { openlibrary_work_id, title, author, cover_url, first_publish_year, description }
 * @returns {Promise<{book: object|null, error: string|null}>}
 */
async function getOrCreateBook(bookData) {
  const client = getSupabaseClient();
  if (!client) return { book: null, error: "Setup incomplete. Please try again later." };

  // 1. Try to find an existing cache row.
  const { data: existing, error: findError } = await client
    .from("books")
    .select("*")
    .eq("openlibrary_work_id", bookData.openlibrary_work_id)
    .maybeSingle();

  if (findError) {
    console.error("Failed to look up cached book:", findError);
    return { book: null, error: "Something went wrong loading this book. Please try again." };
  }

  if (existing) {
    return { book: existing, error: null };
  }

  // 2. Not cached yet — create it now that a user is interacting with it.
  const { data: created, error: insertError } = await client
    .from("books")
    .insert({
      openlibrary_work_id: bookData.openlibrary_work_id,
      title: bookData.title,
      author: bookData.author || null,
      cover_url: bookData.cover_url || null,
      first_publish_year: bookData.first_publish_year || null,
      description: bookData.description || null,
    })
    .select()
    .single();

  if (insertError) {
    // Handle a race: two users adding the same new book at once.
    if (insertError.code === "23505") {
      const { data: raceRow } = await client
        .from("books")
        .select("*")
        .eq("openlibrary_work_id", bookData.openlibrary_work_id)
        .single();
      if (raceRow) return { book: raceRow, error: null };
    }
    console.error("Failed to cache book:", insertError);
    return { book: null, error: "Something went wrong saving this book. Please try again." };
  }

  return { book: created, error: null };
}

/** Look up a cached book by its internal UUID. */
async function getBookById(bookId) {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.from("books").select("*").eq("id", bookId).maybeSingle();
  if (error) {
    console.error("Failed to load book:", error);
    return null;
  }
  return data;
}

/**
 * Backfill a missing cover on an already-cached book (self-healing for
 * books cached before a cover was known, e.g. from a stale link).
 * Best-effort: failures are logged but never block page rendering.
 */
async function updateBookCover(bookId, coverUrl) {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("books")
    .update({ cover_url: coverUrl })
    .eq("id", bookId)
    .select()
    .single();
  if (error) {
    console.error("Failed to backfill book cover:", error);
    return null;
  }
  return data;
}

/**
 * For a batch of live Open Library search results, find which ones the
 * current user already has in their library and with what status. Used
 * to show "already tagged" badges and filters on the Search page.
 *
 * Checks TWO possible ids per result: the result's real Open Library
 * work id, AND the synthetic id a CSV-imported version of that same
 * book would have (see makeImportWorkId) — imported books were never
 * looked up live, so they only exist under that synthetic id, and
 * would otherwise never show as "already in your library" here.
 *
 * @param {Array<{openlibrary_work_id: string, title: string, author: string}>} results
 * @returns {Promise<Map<string, string>>} result's openlibrary_work_id -> status ("want"/"have"/"read")
 */
async function getMyStatusesForSearchResults(results) {
  const map = new Map();
  const client = getSupabaseClient();
  if (!client || !results || results.length === 0) return map;

  const user = await getCurrentUser();
  if (!user) return map;

  // Build every candidate id we should check, and remember which
  // result(s) each candidate id belongs to.
  const idToResultKeys = new Map(); // candidateId -> Set of result.openlibrary_work_id
  const allCandidateIds = new Set();

  for (const r of results) {
    const candidates = [r.openlibrary_work_id, makeImportWorkId(r.author, r.title)];
    for (const id of candidates) {
      allCandidateIds.add(id);
      if (!idToResultKeys.has(id)) idToResultKeys.set(id, new Set());
      idToResultKeys.get(id).add(r.openlibrary_work_id);
    }
  }

  // Step 1: which of these candidate ids are cached locally?
  const { data: cachedBooks, error: booksError } = await client
    .from("books")
    .select("id, openlibrary_work_id")
    .in("openlibrary_work_id", Array.from(allCandidateIds));

  if (booksError) {
    console.error("Failed to look up cached books for status check:", booksError);
    return map;
  }
  if (!cachedBooks || cachedBooks.length === 0) return map;

  const bookIdToCandidateId = new Map(cachedBooks.map((b) => [b.id, b.openlibrary_work_id]));
  const bookIds = cachedBooks.map((b) => b.id);

  // Step 2: of those, which does the current user have a status for?
  const { data: myRows, error: statusError } = await client
    .from("user_books")
    .select("book_id, status")
    .eq("user_id", user.id)
    .in("book_id", bookIds);

  if (statusError) {
    console.error("Failed to look up your statuses for search results:", statusError);
    return map;
  }

  for (const row of myRows) {
    const candidateId = bookIdToCandidateId.get(row.book_id);
    const resultKeys = idToResultKeys.get(candidateId);
    if (!resultKeys) continue;
    for (const resultKey of resultKeys) {
      map.set(resultKey, row.status);
    }
  }
  return map;
}

/**
 * Apply a user-confirmed Open Library match to a cached book: fills in
 * the cover, backfills the publish year if we didn't have one, and —
 * when safe — upgrades the book's identity from a synthetic (e.g.
 * CSV-imported) id to the real Open Library work id the user just
 * confirmed. That upgrade is what lets the book start matching by its
 * real id in future searches, instead of relying on the fuzzier
 * title+author fallback.
 *
 * Changing openlibrary_work_id doesn't touch any existing user_books
 * or reviews rows — those reference the book's stable internal id
 * (books.id), never openlibrary_work_id, so nobody's status or review
 * is affected by the upgrade.
 *
 * The one thing that blocks the upgrade: if some *other* cached book
 * row already has that real work id (e.g. someone else added the same
 * book via live search, creating a separate row), we can't reuse it —
 * that would violate the "one row per work id" uniqueness rule and
 * would really require merging the two rows' statuses/reviews, which
 * is beyond this MVP. In that case we still save the cover and year,
 * just not the id upgrade.
 */
async function confirmBookCoverMatch(bookId, match) {
  const client = getSupabaseClient();
  if (!client) return { error: "Setup incomplete. Please try again later." };

  const current = await getBookById(bookId);
  const updates = { cover_url: match.cover_url };

  // Only backfill the year if we don't already have one — never
  // overwrite a value the book already had.
  if (match.first_publish_year && current && !current.first_publish_year) {
    updates.first_publish_year = match.first_publish_year;
  }

  // Try the id upgrade, unless this book already has a real (non-CSV)
  // id, or some other row already owns the confirmed id.
  const alreadyHasRealId = current && !current.openlibrary_work_id.startsWith("csv-");
  if (!alreadyHasRealId && match.openlibrary_work_id) {
    const { data: conflict } = await client
      .from("books")
      .select("id")
      .eq("openlibrary_work_id", match.openlibrary_work_id)
      .neq("id", bookId)
      .maybeSingle();

    if (!conflict) {
      updates.openlibrary_work_id = match.openlibrary_work_id;
    }
  }

  const { data, error } = await client.from("books").update(updates).eq("id", bookId).select().single();
  if (error) {
    console.error("Failed to apply confirmed cover match:", error);
    return { error: "Couldn't save that cover. Please try again." };
  }
  return { book: data, error: null };
}

/** Look up a cached book by its Open Library work id. */
async function getBookByWorkId(workId) {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("books")
    .select("*")
    .eq("openlibrary_work_id", workId)
    .maybeSingle();
  if (error) {
    console.error("Failed to load book:", error);
    return null;
  }
  return data;
}

/**
 * Set (create or change) the current user's status for a book.
 * status: "want" | "have" | "read"
 */
async function setBookStatus(bookId, status) {
  const client = getSupabaseClient();
  if (!client) return { error: "Setup incomplete. Please try again later." };

  const user = await getCurrentUser();
  if (!user) return { error: "Please log in to add books to your library." };

  if (!["want", "have", "read"].includes(status)) {
    return { error: "Invalid status." };
  }

  const { data, error } = await client
    .from("user_books")
    .upsert(
      { user_id: user.id, book_id: bookId, status },
      { onConflict: "user_id,book_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("Failed to set book status:", error);
    return { error: "Couldn't update your library. Please try again." };
  }

  return { userBook: data, error: null };
}

/** Remove a book entirely from the current user's library. */
async function removeBookStatus(bookId) {
  const client = getSupabaseClient();
  if (!client) return { error: "Setup incomplete. Please try again later." };
  const user = await getCurrentUser();
  if (!user) return { error: "Please log in first." };

  const { error } = await client
    .from("user_books")
    .delete()
    .eq("user_id", user.id)
    .eq("book_id", bookId);

  if (error) {
    console.error("Failed to remove book:", error);
    return { error: "Couldn't update your library. Please try again." };
  }
  return { error: null };
}

/** Get the current user's status row for a specific book (or null). */
async function getMyStatusForBook(bookId) {
  const client = getSupabaseClient();
  if (!client) return null;
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await client
    .from("user_books")
    .select("*")
    .eq("user_id", user.id)
    .eq("book_id", bookId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load your status:", error);
    return null;
  }
  return data;
}

/**
 * Get all of the current user's books, joined with book details,
 * grouped by status. Used by my-books.html.
 */
async function getMyBooksByStatus() {
  const client = getSupabaseClient();
  const empty = { want: [], have: [], read: [] };
  if (!client) return empty;

  const user = await getCurrentUser();
  if (!user) return empty;

  const { data, error } = await client
    .from("user_books")
    .select("*, books(*)")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Failed to load your books:", error);
    return empty;
  }

  const grouped = { want: [], have: [], read: [] };
  for (const row of data) {
    if (grouped[row.status]) grouped[row.status].push(row);
  }
  return grouped;
}

/** Community counts for a book: how many users have it as want/have/read. */
async function getCommunityCountsForBook(bookId) {
  const client = getSupabaseClient();
  const empty = { want_count: 0, have_count: 0, read_count: 0, total_count: 0 };
  if (!client) return empty;

  const { data, error } = await client
    .from("book_status_counts")
    .select("*")
    .eq("book_id", bookId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load community counts:", error);
    return empty;
  }
  return data || empty;
}

/** A handful of other users (by username) who have this book, for a given status. */
async function getUsersWithStatus(bookId, status, limit = 5) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("user_books")
    .select("user_id, profiles(username, display_name)")
    .eq("book_id", bookId)
    .eq("status", status)
    .limit(limit);

  if (error) {
    console.error("Failed to load users with status:", error);
    return [];
  }
  return data.filter((row) => row.profiles).map((row) => row.profiles);
}

/**
 * Homepage helper: recently added books (by any user) across the
 * community, and recently marked "read". Simple queries, no
 * recommendation engine, per the MVP spec.
 */
async function getRecentlyAddedBooks(limit = 10) {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("books")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("Failed to load recently added books:", error);
    return [];
  }
  return data;
}

async function getRecentlyReadBooks(limit = 10) {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("user_books")
    .select("updated_at, books(*)")
    .eq("status", "read")
    .order("updated_at", { ascending: false })
    .limit(limit * 2); // fetch extra, then de-dupe by book below

  if (error) {
    console.error("Failed to load recently read books:", error);
    return [];
  }

  const seen = new Set();
  const books = [];
  for (const row of data) {
    if (!row.books || seen.has(row.books.id)) continue;
    seen.add(row.books.id);
    books.push(row.books);
    if (books.length >= limit) break;
  }
  return books;
}

/** "Popular in the community" = books with the most total user_books rows. */
async function getPopularBooks(limit = 10) {
  const client = getSupabaseClient();
  if (!client) return [];

  // Views aren't always embeddable via PostgREST foreign-table syntax,
  // so this is a simple two-step lookup instead of a join.
  const { data: counts, error: countsError } = await client
    .from("book_status_counts")
    .select("book_id, total_count")
    .order("total_count", { ascending: false })
    .limit(limit);

  if (countsError) {
    console.error("Failed to load popular books:", countsError);
    return [];
  }
  if (!counts || counts.length === 0) return [];

  const bookIds = counts.map((row) => row.book_id);
  const { data: books, error: booksError } = await client
    .from("books")
    .select("*")
    .in("id", bookIds);

  if (booksError) {
    console.error("Failed to load popular books' details:", booksError);
    return [];
  }

  // Preserve the popularity ordering from `counts`.
  const byId = new Map(books.map((b) => [b.id, b]));
  return bookIds.map((id) => byId.get(id)).filter(Boolean);
}
