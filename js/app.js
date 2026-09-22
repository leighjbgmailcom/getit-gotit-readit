// =====================================================================
// GetIt GotIt ReadIt — Shared app utilities
// Nav rendering, toasts, book-card markup, and small helpers used
// across every page.
// =====================================================================

/** Escape untrusted text before inserting into innerHTML. */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Read a query-string parameter from the current URL. */
function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Show a transient toast message at the bottom of the screen. */
function showToast(message, type = "info", duration = 3500) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, duration);
}

/** Show an inline alert box inside a given container element. */
function showAlert(containerEl, message, type = "error") {
  if (!containerEl) return;
  containerEl.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
  containerEl.classList.remove("hidden");
}

function clearAlert(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = "";
  containerEl.classList.add("hidden");
}

/** Friendly formatting for a publish year, or blank if unknown. */
function formatYear(year) {
  return year ? String(year) : "";
}

/** Friendly relative-ish date for reviews / activity. */
function formatDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_LABELS = { want: "GET IT", have: "GOT IT", read: "READ IT" };
const STATUS_BADGE_CLASS = { want: "badge-want", have: "badge-have", read: "badge-read" };

/**
 * Build the HTML for a book card, used in search results, my-books
 * grids, and homepage sections.
 *
 * @param {object} book - { openlibrary_work_id, title, author, cover_url, first_publish_year, id? }
 * @param {object} opts - { status: 'want'|'have'|'read'|null, linkBy: 'work'|'id' }
 */
function renderBookCard(book, opts = {}) {
  const linkBy = opts.linkBy || (book.id ? "id" : "work");
  let href;
  if (linkBy === "id") {
    href = `book.html?id=${encodeURIComponent(book.id)}`;
  } else {
    // Carry along what we already know (title/author/year/cover) from the
    // search result, since Open Library's /works/ endpoint often has no
    // cover of its own (covers usually live on editions, not works) —
    // without this, a book with a perfectly good cover in search results
    // would lose it the moment it's cached from the detail page.
    const params = new URLSearchParams();
    params.set("work", book.openlibrary_work_id);
    if (book.title) params.set("t", book.title);
    if (book.author) params.set("a", book.author);
    if (book.first_publish_year) params.set("y", book.first_publish_year);
    if (book.cover_url) params.set("c", book.cover_url);
    href = `book.html?${params.toString()}`;
  }

  const coverHtml = book.cover_url
    ? `<img src="${escapeHtml(book.cover_url)}" alt="Cover of ${escapeHtml(book.title)}" loading="lazy" onerror="this.parentElement.innerHTML = getCoverPlaceholderHtml();">`
    : getCoverPlaceholderHtml();

  const year = formatYear(book.first_publish_year);
  const badge = opts.status
    ? `<span class="book-card-status-badge ${STATUS_BADGE_CLASS[opts.status]}">${STATUS_LABELS[opts.status]}</span>`
    : "";

  return `
    <a class="book-card" href="${href}">
      <div class="book-cover-wrap">${coverHtml}</div>
      <div class="book-card-body">
        <div class="book-card-title">${escapeHtml(book.title)}</div>
        <div class="book-card-author">${escapeHtml(book.author || "Unknown author")}</div>
        ${year ? `<div class="book-card-year">${escapeHtml(year)}</div>` : ""}
        <div class="book-card-footer">${badge}</div>
      </div>
    </a>
  `;
}

function getCoverPlaceholderHtml() {
  return `
    <div class="book-cover-placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17Z"/>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      </svg>
      <span>No cover available</span>
    </div>
  `;
}

/** Render a grid of book cards into a container, or an empty state. */
function renderBookGrid(containerEl, books, opts = {}) {
  if (!containerEl) return;
  if (!books || books.length === 0) {
    containerEl.innerHTML = `<div class="empty-state">${opts.emptyMessage || "Nothing here yet."}</div>`;
    return;
  }
  containerEl.innerHTML = `<div class="book-grid">${books
    .map((b) => renderBookCard(b, opts.cardOpts ? opts.cardOpts(b) : {}))
    .join("")}</div>`;
}

// ---------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------

/**
 * Initializes the shared header: highlights the active page, wires the
 * mobile menu toggle, and swaps the auth area between "Log In / Sign
 * Up" and "My Books / Profile / Log out" depending on session state.
 * Call this once on every page, after DOMContentLoaded.
 */
async function initNav() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  document.querySelectorAll(".nav-links a, .nav-mobile-panel a[data-nav]").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === currentPage) {
      link.classList.add("active");
    }
  });

  const toggle = document.getElementById("nav-toggle");
  const panel = document.getElementById("nav-mobile-panel");
  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      panel.classList.toggle("open");
    });
  }

  const authArea = document.getElementById("nav-auth-actions");
  const mobileAuthArea = document.getElementById("nav-mobile-auth-actions");
  if (!authArea && !mobileAuthArea) return;

  const client = getSupabaseClient();
  if (!client) {
    return; // config warning banner already shown by getSupabaseClient()
  }

  const user = await getCurrentUser();

  const desktopHtml = user
    ? `<a href="my-books.html" class="btn btn-ghost btn-sm">My Books</a>
       <button id="nav-logout-btn" class="btn btn-secondary btn-sm">Log Out</button>`
    : `<a href="login.html" class="btn btn-ghost btn-sm">Log In</a>
       <a href="signup.html" class="btn btn-primary btn-sm">Sign Up</a>`;

  const mobileHtml = user
    ? `<a href="my-books.html" data-nav>My Books</a>
       <a href="profile.html" data-nav>My Profile</a>
       <a href="#" id="nav-logout-btn-mobile" data-nav>Log Out</a>`
    : `<a href="login.html" data-nav>Log In</a>
       <a href="signup.html" data-nav>Sign Up</a>`;

  if (authArea) authArea.innerHTML = desktopHtml;
  if (mobileAuthArea) mobileAuthArea.innerHTML = mobileHtml;

  const logoutBtn = document.getElementById("nav-logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", signOut);
  const logoutBtnMobile = document.getElementById("nav-logout-btn-mobile");
  if (logoutBtnMobile) {
    logoutBtnMobile.addEventListener("click", (e) => {
      e.preventDefault();
      signOut();
    });
  }

  // If logged in, also point the "Profile" nav link (if present) at
  // this user's own public profile.
  if (user) {
    const profile = await getCurrentProfile();
    const profileLink = document.getElementById("nav-profile-link");
    if (profileLink && profile) {
      profileLink.setAttribute("href", `profile.html?u=${encodeURIComponent(profile.username)}`);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initNav();
});
