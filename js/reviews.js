// =====================================================================
// GetIt GotIt ReadIt — Reviews data layer
// =====================================================================

/** All reviews for a book, newest first, with reviewer username. */
async function getReviewsForBook(bookId) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("reviews")
    .select("*, profiles(username, display_name)")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load reviews:", error);
    return [];
  }
  return data;
}

/** The current user's own review for a book (or null). */
async function getMyReviewForBook(bookId) {
  const client = getSupabaseClient();
  if (!client) return null;
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await client
    .from("reviews")
    .select("*")
    .eq("book_id", bookId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load your review:", error);
    return null;
  }
  return data;
}

/**
 * Create or update the current user's review for a book.
 * @param {string} bookId
 * @param {number|null} rating - 1-5, or null for review-only
 * @param {string|null} reviewText - or null for rating-only
 */
async function saveReview(bookId, rating, reviewText) {
  const client = getSupabaseClient();
  if (!client) return { error: "Setup incomplete. Please try again later." };

  const user = await getCurrentUser();
  if (!user) return { error: "Please log in to leave a review." };

  const cleanRating = rating ? Number(rating) : null;
  const cleanText = reviewText && reviewText.trim() ? reviewText.trim() : null;

  if (cleanRating !== null && (cleanRating < 1 || cleanRating > 5 || !Number.isInteger(cleanRating))) {
    return { error: "Please choose a rating between 1 and 5 stars." };
  }
  if (cleanRating === null && !cleanText) {
    return { error: "Please add a star rating or a written review." };
  }

  const { data, error } = await client
    .from("reviews")
    .upsert(
      { user_id: user.id, book_id: bookId, rating: cleanRating, review: cleanText },
      { onConflict: "user_id,book_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("Failed to save review:", error);
    return { error: "Couldn't save your review. Please try again." };
  }
  return { review: data, error: null };
}

/** Delete the current user's review for a book. */
async function deleteReview(bookId) {
  const client = getSupabaseClient();
  if (!client) return { error: "Setup incomplete. Please try again later." };
  const user = await getCurrentUser();
  if (!user) return { error: "Please log in first." };

  const { error } = await client.from("reviews").delete().eq("book_id", bookId).eq("user_id", user.id);
  if (error) {
    console.error("Failed to delete review:", error);
    return { error: "Couldn't delete your review. Please try again." };
  }
  return { error: null };
}

/** Render a 1-5 rating as a ★★★★☆-style string (used in read-only display). */
function starsHtml(rating) {
  const full = Math.round(rating || 0);
  let html = '<span class="stars">';
  for (let i = 1; i <= 5; i++) {
    html += i <= full ? "★" : '<span class="empty">★</span>';
  }
  html += "</span>";
  return html;
}
