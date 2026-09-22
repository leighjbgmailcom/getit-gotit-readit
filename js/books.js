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
 * Strip accents, casing, and punctuation down to bare words for
 * comparing titles/authors that may be formatted slightly differently
 * between a spreadsheet import and Open Library's own text (smart
 * quotes vs straight quotes, "&" vs "and", stray colons, etc).
 */
function normalizeForMatch(str) {
  return (str || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Looser than normalizeForMatch: also drops a subtitle or series/edition
 * annotation after the first ":" or "(" — e.g. "Gone Girl: A Novel" and
 * "Gone Girl (Movie Tie-In)" both become "gone girl". Used only for
 * *suggesting* a possible match, never for auto-confirming one, since
 * it's loose enough to occasionally conflate two different books.
 */
function normalizeLoose(str) {
  const cut = (str || "").split(/[:(]/)[0];
  return normalizeForMatch(cut);
}

function authorsLikelyMatch(a, b) {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return true; // unknown author on either side — don't let it block a title match
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Fetch the current user's whole library (every status) with just the
 * fields needed to fuzzy-match it against search results: title,
 * author, cover, and internal id. One query, reused across all results
 * on the page rather than a lookup per result.
 */
async function getMyLibraryForMatching() {
  const client = getSupabaseClient();
  if (!client) return [];
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await client
    .from("user_books")
    .select("status, books(id, title, author, cover_url, openlibrary_work_id)")
    .eq("user_id", user.id);

  if (error) {
    console.error("Failed to load your library for search matching:", error);
    return [];
  }

  return (data || [])
    .filter((row) => row.books)
    .map((row) => ({
      bookId: row.books.id,
      title: row.books.title,
      author: row.books.author,
      coverUrl: row.books.cover_url,
      workId: row.books.openlibrary_work_id,
      status: row.status,
    }));
}

/**
 * Compare a page of live search results against the user's library and
 * tag each result with:
 *   - myStatus / matchedEntry: a CONFIRMED match (title+author line up
 *     once normalized) — shown as an "already tagged" badge, same as
 *     before.
 *   - possibleMatch: a LOOSER match (subtitle/annotation ignored) that
 *     isn't confident enough to auto-tag, but worth surfacing as "you
 *     might already have this" with a compare-and-confirm prompt.
 * Mutates and returns the same result objects for convenience.
 */
function matchSearchResultsToLibrary(results, libraryEntries) {
  for (const r of results) {
    r.myStatus = null;
    r.matchedEntry = null;
    r.possibleMatch = null;

    const rStrict = normalizeForMatch(r.title);
    const rLoose = normalizeLoose(r.title);

    for (const entry of libraryEntries) {
      if (!authorsLikelyMatch(r.author, entry.author)) continue;

      if (normalizeForMatch(entry.title) === rStrict) {
        r.myStatus = entry.status;
        r.matchedEntry = entry;
        r.possibleMatch = null;
        break; // confirmed match wins outright, stop looking
      }
      if (!r.possibleMatch && normalizeLoose(entry.title) === rLoose) {
        r.possibleMatch = entry;
      }
    }
  }
  return results;
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
  const updates = {};

  // Only set the cover if the match actually has one — never overwrite
  // an existing cover with a blank value.
  if (match.cover_url) {
    updates.cover_url = match.cover_url;
  }

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

  if (Object.keys(updates).length === 0) {
    // Nothing new to save (no cover, year already known, id already real
    // or conflicting) — just confirm the book as-is rather than sending
    // an empty update.
    return { book: current, error: null };
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
