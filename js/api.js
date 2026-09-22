// =====================================================================
// GetIt GotIt ReadIt — Open Library integration
// =====================================================================
// All book catalogue data comes from Open Library's free public API.
// We never store the whole catalogue — only a lightweight cache row
// (see books.js) gets created the moment a user actually adds a book.
// =====================================================================

/**
 * Search Open Library.
 * @param {string} query - the raw search text
 * @param {"title"|"author"|"isbn"|"keyword"} mode
 * @returns {Promise<{results: Array, error: string|null}>}
 */
async function searchOpenLibrary(query, mode = "keyword") {
  const trimmed = (query || "").trim();
  if (!trimmed) {
    return { results: [], error: "Please enter something to search for." };
  }

  let url;
  const params = new URLSearchParams();
  params.set("limit", "24");
  params.set(
    "fields",
    "key,title,author_name,first_publish_year,cover_i,cover_edition_key,isbn,edition_key"
  );

  if (mode === "isbn") {
    // Clean ISBN input (strip dashes/spaces) and search directly.
    const cleanIsbn = trimmed.replace(/[^0-9Xx]/g, "");
    params.set("isbn", cleanIsbn);
  } else if (mode === "title") {
    params.set("title", trimmed);
  } else if (mode === "author") {
    params.set("author", trimmed);
  } else {
    params.set("q", trimmed);
  }

  url = `${OPEN_LIBRARY_BASE}/search.json?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open Library returned ${res.status}`);
    }
    const data = await res.json();
    const docs = Array.isArray(data.docs) ? data.docs : [];

    const results = docs
      .filter((doc) => doc.key) // must have a work key like "/works/OL123W"
      .map((doc) => normalizeSearchDoc(doc));

    if (results.length === 0) {
      return { results: [], error: "No books found. Try a different search." };
    }

    return { results, error: null };
  } catch (err) {
    console.error("Open Library search failed:", err);
    return {
      results: [],
      error: "The book catalogue is unavailable right now. Please try again shortly.",
    };
  }
}

function normalizeSearchDoc(doc) {
  const workId = doc.key.replace("/works/", "");
  const coverUrl = doc.cover_i
    ? `${OPEN_LIBRARY_COVERS_BASE}/b/id/${doc.cover_i}-M.jpg`
    : doc.cover_edition_key
    ? `${OPEN_LIBRARY_COVERS_BASE}/b/olid/${doc.cover_edition_key}-M.jpg`
    : null;

  return {
    openlibrary_work_id: workId,
    title: doc.title || "Untitled",
    author: Array.isArray(doc.author_name) && doc.author_name.length ? doc.author_name.join(", ") : "Unknown author",
    first_publish_year: doc.first_publish_year || null,
    cover_url: coverUrl,
  };
}

/**
 * Fetch extra detail for a single work (used on the Book Details page
 * for description text and a larger cover if we don't already have one).
 */
async function getOpenLibraryWorkDetails(workId) {
  try {
    const res = await fetch(`${OPEN_LIBRARY_BASE}/works/${workId}.json`);
    if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
    const data = await res.json();

    let description = null;
    if (typeof data.description === "string") {
      description = data.description;
    } else if (data.description && typeof data.description.value === "string") {
      description = data.description.value;
    }

    let coverUrl = null;
    if (Array.isArray(data.covers) && data.covers.length && data.covers[0] > 0) {
      coverUrl = `${OPEN_LIBRARY_COVERS_BASE}/b/id/${data.covers[0]}-L.jpg`;
    }

    // Author names require a follow-up request per author key.
    let authorNames = [];
    if (Array.isArray(data.authors) && data.authors.length) {
      const authorKeys = data.authors
        .map((a) => (a.author && a.author.key) || a.key)
        .filter(Boolean)
        .slice(0, 3);
      const names = await Promise.all(
        authorKeys.map(async (key) => {
          try {
            const aRes = await fetch(`${OPEN_LIBRARY_BASE}${key}.json`);
            if (!aRes.ok) return null;
            const aData = await aRes.json();
            return aData.name || null;
          } catch {
            return null;
          }
        })
      );
      authorNames = names.filter(Boolean);
    }

    return {
      title: data.title || null,
      description,
      coverUrl,
      authorNames,
      subjects: Array.isArray(data.subjects) ? data.subjects.slice(0, 6) : [],
      error: null,
    };
  } catch (err) {
    console.error("Failed to load Open Library work details:", err);
    return { title: null, description: null, coverUrl: null, authorNames: [], subjects: [], error: "not_available" };
  }
}

/**
 * Build a full-size cover URL for display on the Book Details page,
 * upgrading a medium ("-M") thumbnail to large ("-L") when possible.
 */
function getLargeCoverUrl(coverUrl) {
  if (!coverUrl) return null;
  return coverUrl.replace("-M.jpg", "-L.jpg").replace("-S.jpg", "-L.jpg");
}
