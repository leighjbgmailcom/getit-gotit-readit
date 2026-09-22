// =====================================================================
// GetIt GotIt ReadIt — Authentication helpers
// Wraps Supabase Auth (email/password) with friendly error handling.
// =====================================================================

/**
 * Sign up a new user with email, password, and a desired username.
 * Returns { user, session, error }.
 */
async function signUp(email, password, username) {
  const client = getSupabaseClient();
  if (!client) return { error: "Setup incomplete. Please try again later." };

  const cleanUsername = (username || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
    return {
      error:
        "Usernames must be 3-20 characters, using lowercase letters, numbers, and underscores only.",
    };
  }

  // Tell Supabase explicitly where the confirmation link should land,
  // rather than relying on the "Site URL" set in the Supabase dashboard
  // (which is easy to leave pointed at the wrong path). This must still
  // match one of the "Redirect URLs" patterns configured in Supabase
  // Authentication settings, or Supabase will silently fall back to the
  // Site URL anyway.
  const emailRedirectTo = new URL("login.html", window.location.href).toString();

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { username: cleanUsername, display_name: cleanUsername },
      emailRedirectTo,
    },
  });

  if (error) {
    return { error: friendlyAuthError(error) };
  }

  return { user: data.user, session: data.session };
}

/** Log in an existing user. Returns { user, session, error }. */
async function signIn(email, password) {
  const client = getSupabaseClient();
  if (!client) return { error: "Setup incomplete. Please try again later." };

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: friendlyAuthError(error) };
  }
  return { user: data.user, session: data.session };
}

/** Log out the current user. */
async function signOut() {
  const client = getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
  window.location.href = "index.html";
}

/** Send a password-reset email. Returns { error } or {}. */
async function sendPasswordReset(email) {
  const client = getSupabaseClient();
  if (!client) return { error: "Setup incomplete. Please try again later." };

  const redirectTo = new URL("login.html", window.location.href).toString();
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    return { error: friendlyAuthError(error) };
  }
  return {};
}

/** Update the logged-in user's password (used after a reset-password link). */
async function updatePassword(newPassword) {
  const client = getSupabaseClient();
  if (!client) return { error: "Setup incomplete. Please try again later." };

  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) {
    return { error: friendlyAuthError(error) };
  }
  return {};
}

/** Get the current logged-in user (or null). */
async function getCurrentUser() {
  const client = getSupabaseClient();
  if (!client) return null;
  const {
    data: { user },
  } = await client.auth.getUser();
  return user;
}

/** Get the current user's profile row (or null). */
async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error) {
    console.error("Failed to load current profile:", error);
    return null;
  }
  return data;
}

/**
 * Redirect to login.html if nobody is signed in. Use on pages that
 * require auth. Returns the user if signed in, otherwise redirects
 * and returns null.
 */
async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    const returnTo = encodeURIComponent(window.location.pathname.split("/").pop());
    window.location.href = `login.html?redirect=${returnTo}`;
    return null;
  }
  return user;
}

/** Translate raw Supabase auth errors into friendly messages. */
function friendlyAuthError(error) {
  const msg = (error && error.message) || "";
  if (/already registered|already exists/i.test(msg)) {
    return "An account with that email already exists. Try logging in instead.";
  }
  if (/invalid login credentials/i.test(msg)) {
    return "Incorrect email or password. Please try again.";
  }
  if (/email not confirmed/i.test(msg)) {
    return "Please confirm your email address before logging in (check your inbox).";
  }
  if (/password should be at least/i.test(msg)) {
    return "Password is too short. Please use at least 6 characters.";
  }
  if (/unable to validate email/i.test(msg) || /invalid email/i.test(msg)) {
    return "Please enter a valid email address.";
  }
  if (/rate limit/i.test(msg)) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (/duplicate key value.*username/i.test(msg) || /profiles_username/i.test(msg)) {
    return "That username is already taken. Please choose another.";
  }
  console.error("Auth error:", error);
  return "Something went wrong. Please try again in a moment.";
}
