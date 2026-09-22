// =====================================================================
// GetIt GotIt ReadIt — CSV Library Import
// =====================================================================
// Lets a logged-in user bulk-import their existing book list from a
// CSV file (e.g. exported from a spreadsheet) instead of adding books
// one at a time. Expected columns (header row required), in any
// order — extra columns are ignored:
//
//   Author, Book Title, Status, Year
//
// Status values are matched case-insensitively:
//   "Read It"                        -> read
//   "Get It"                         -> want
//   anything starting with "Got It"  -> have  (e.g. "Got It - Paper",
//                                               "Got It - Kindle")
//
// Imported books do NOT go through a live Open Library lookup (that
// would mean one API call per row, which isn't practical for a large
// personal library in one go) — they're cached directly from the
// spreadsheet's own title/author/year, with a stable synthetic id so
// re-running the same import file is safe (it updates existing rows
// instead of duplicating them). Covers show the app's normal
// placeholder unless the book is later re-added via Search, which
// will pick up its real Open Library cover.
// =====================================================================

/** Parse CSV text (RFC4180-ish: handles quoted fields, embedded commas/quotes) into rows of arrays. */
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // skip; \n handles the line break
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Parse CSV text into an array of objects keyed by the header row. */
function parseCsvObjects(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (row[idx] !== undefined ? row[idx] : "").trim();
    });
    return obj;
  });
}

/** Map a free-text status column value to our want/have/read enum, or null if unrecognized. */
function mapImportStatus(raw) {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "read it" || s === "read") return "read";
  if (s === "get it" || s === "want" || s === "want it") return "want";
  if (s.startsWith("got it") || s === "have" || s === "own") return "have";
  return null;
}

// stableHash() and makeImportWorkId() moved to books.js, since search.html
// also needs to compute the same synthetic id to recognize imported books
// in search results (they don't have a real Open Library work id).

/**
 * Read rows from parsed CSV objects and normalize them into unique,
 * importable books (deduping by author+title — last row wins for
 * status if the same book appears more than once in the file).
 */
function normalizeImportRows(csvObjects) {
  const titleKey = ["Book Title", "Title", "book title", "title"].find((k) =>
    csvObjects[0] ? k in csvObjects[0] : false
  );
  const authorKey = ["Author", "author"].find((k) => (csvObjects[0] ? k in csvObjects[0] : false));
  const statusKey = ["Status", "status"].find((k) => (csvObjects[0] ? k in csvObjects[0] : false));
  const yearKey = ["Year", "year"].find((k) => (csvObjects[0] ? k in csvObjects[0] : false));

  const summary = { totalRows: csvObjects.length, missingTitle: 0, missingStatus: 0, duplicatesCollapsed: 0 };
  const byWorkId = new Map();

  for (const row of csvObjects) {
    const title = titleKey ? row[titleKey] : "";
    const author = authorKey ? row[authorKey] : "";
    const status = mapImportStatus(statusKey ? row[statusKey] : "");
    const yearRaw = yearKey ? row[yearKey] : "";
    const year = /^\d{3,4}$/.test(yearRaw) ? Number(yearRaw) : null;

    if (!title.trim()) {
      summary.missingTitle++;
      continue;
    }
    if (!status) {
      summary.missingStatus++;
      continue;
    }

    const workId = makeImportWorkId(author || "Unknown", title);
    if (byWorkId.has(workId)) summary.duplicatesCollapsed++;

    byWorkId.set(workId, {
      openlibrary_work_id: workId,
      title: title.trim(),
      author: author.trim() || null,
      first_publish_year: year,
      status,
    });
  }

  return { books: Array.from(byWorkId.values()), summary };
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/**
 * Run the full import for the currently logged-in user: batch-caches
 * every book into `books`, then batch-sets each one's status in
 * `user_books` for that user. Reports progress via onProgress(message).
 */
async function runCsvImport(csvText, onProgress) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Setup incomplete. Please try again later.");

  const user = await getCurrentUser();
  if (!user) throw new Error("Please log in before importing.");

  onProgress("Reading file…");
  const csvObjects = parseCsvObjects(csvText);
  if (csvObjects.length === 0) {
    throw new Error("That file doesn't look like a CSV, or it's empty.");
  }

  const { books, summary } = normalizeImportRows(csvObjects);
  if (books.length === 0) {
    throw new Error(
      "No importable rows found. Make sure the file has 'Book Title', 'Author', and 'Status' columns."
    );
  }

  onProgress(`Found ${books.length} unique books to import (of ${summary.totalRows} rows). Caching books…`);

  const bookChunks = chunkArray(
    books.map((b) => ({
      openlibrary_work_id: b.openlibrary_work_id,
      title: b.title,
      author: b.author,
      first_publish_year: b.first_publish_year,
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
      console.error("Import: failed to cache a batch of books:", error);
      throw new Error("Something went wrong saving books. Please try again.");
    }
    for (const row of data) workIdToBookId.set(row.openlibrary_work_id, row.id);
  }

  onProgress("Setting your reading statuses…");

  const statusRows = books
    .map((b) => ({
      user_id: user.id,
      book_id: workIdToBookId.get(b.openlibrary_work_id),
      status: b.status,
    }))
    .filter((r) => r.book_id);

  const statusChunks = chunkArray(statusRows, 200);
  let statusesSet = 0;
  for (let i = 0; i < statusChunks.length; i++) {
    onProgress(`Setting statuses… batch ${i + 1} of ${statusChunks.length}`);
    const { error } = await client
      .from("user_books")
      .upsert(statusChunks[i], { onConflict: "user_id,book_id" });
    if (error) {
      console.error("Import: failed to set a batch of statuses:", error);
      throw new Error("Books were cached, but something went wrong setting your statuses. Please try again.");
    }
    statusesSet += statusChunks[i].length;
  }

  return {
    totalRows: summary.totalRows,
    booksImported: books.length,
    statusesSet,
    skippedMissingTitle: summary.missingTitle,
    skippedMissingStatus: summary.missingStatus,
    duplicatesCollapsed: summary.duplicatesCollapsed,
  };
}
