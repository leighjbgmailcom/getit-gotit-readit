// =====================================================================
// GetIt GotIt ReadIt — Public profile data layer
// =====================================================================

/** Look up a public profile by username. Returns null if not found. */
async function getProfileByUsername(username) {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("username", username.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error("Failed to load profile:", error);
    return null;
  }
  return data;
}

/** GET IT / GOT IT / READ IT counts for a given user id. */
async function getProfileCounts(userId) {
  const client = getSupabaseClient();
  const empty = { want: 0, have: 0, read: 0 };
  if (!client) return empty;

  const { data, error } = await client.from("user_books").select("status").eq("user_id", userId);

  if (error) {
    console.error("Failed to load profile counts:", error);
    return empty;
  }

  const counts = { want: 0, have: 0, read: 0 };
  for (const row of data) {
    if (counts[row.status] !== undefined) counts[row.status]++;
  }
  return counts;
}

/** This user's READ IT books, most recently finished first. */
async function getProfileReadBooks(userId, limit = 12) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("user_books")
    .select("*, books(*)")
    .eq("user_id", userId)
    .eq("status", "read")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to load read books:", error);
    return [];
  }
  return data.filter((row) => row.books);
}

/** This user's most recent reviews, with book details. */
async function getProfileRecentReviews(userId, limit = 6) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("reviews")
    .select("*, books(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to load recent reviews:", error);
    return [];
  }
  return data.filter((row) => row.books);
}

/** Update the current user's own display name (username changes are out of scope for MVP). */
async function updateDisplayName(displayName) {
  const client = getSupabaseClient();
  if (!client) return { error: "Setup incomplete. Please try again later." };
  const user = await getCurrentUser();
  if (!user) return { error: "Please log in first." };

  const { error } = await client
    .from("profiles")
    .update({ display_name: displayName.trim() || null })
    .eq("id", user.id);

  if (error) {
    console.error("Failed to update display name:", error);
    return { error: "Couldn't update your profile. Please try again." };
  }
  return { error: null };
}
