# GetIt GotIt ReadIt

**Your books. Your list. Your next read.**

A social book-tracking MVP. Search books via Open Library, add them to
your personal library, and track whether you **Get It** (want it),
**Got It** (own it), or **Read It** (finished it) — plus rate and
review anything you've read.

Built with plain HTML5, CSS3, and vanilla JavaScript, backed by
Supabase (auth + Postgres + Row Level Security) and the Open Library
API. No frameworks, no build step — it runs as a static site on
GitHub Pages.

---

## 1. Architecture at a glance

- **Book data** (title, author, cover, description) comes from
  [Open Library](https://openlibrary.org/developers/api)'s free public
  API and is never bulk-imported. The first time any user interacts
  with a book, a lightweight cache row is created in the `books`
  table, keyed by the Open Library **Work ID** (e.g. `OL262758W`).
  Every later interaction with that same book reuses the cached row —
  no duplicate lookups, no duplicate storage.
- **User data** (who wants/owns/has read which book, ratings, reviews,
  usernames) lives entirely in Supabase, protected by Row Level
  Security so users can only ever modify their own rows.

```
BOOK (from Open Library, cached once)      USER (from Supabase, per person)
-------------------------------------      --------------------------------
Open Library Work ID: OL12345W             Leigh -> status: READ, rating: 5,
Title: The Wager                                    review: "Fantastic story..."
Author: David Grann                        Priya -> status: WANT
Cover: https://covers.openlibrary.org/...
```

---

## 2. Project structure

```
getit-gotit-readit/
├── index.html          Homepage: hero, search, community sections
├── login.html          Log in + forgot password
├── signup.html         Create an account
├── search.html         Open Library search + results grid
├── book.html           Book details, status buttons, reviews
├── my-books.html       Your Get It / Got It / Read It tabs
├── profile.html        Public profile page
│
├── css/
│   └── style.css       Shared design system
│
├── js/
│   ├── config.js       <-- YOUR SUPABASE CREDENTIALS GO HERE
│   ├── supabase.js     Supabase client bootstrap
│   ├── auth.js         Sign up / log in / log out / password reset
│   ├── api.js          Open Library search + work details
│   ├── books.js        Book cache + user_books (status) logic
│   ├── reviews.js      Ratings & reviews CRUD
│   ├── profile.js      Public profile data
│   └── app.js          Nav rendering, toasts, book-card rendering
│
├── supabase/
│   ├── schema.sql       Run this once in the Supabase SQL Editor
│   └── demo-data.sql    Optional: pre-caches 4 real example books
│
└── README.md            You are here
```

---

## 3. Deploy it — step by step

### Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free account.
2. Click **New Project**. Pick a name, a database password (save it
   somewhere safe — you won't need it for this app, but Supabase
   requires one), and a region close to your users.
3. Wait for the project to finish provisioning (about 1-2 minutes).

### Step 2 — Run the database schema

1. In your Supabase project, open the **SQL Editor** (left sidebar).
2. Click **New query**.
3. Open `supabase/schema.sql` from this repo, copy its entire
   contents, and paste it into the editor.
4. Click **Run**. You should see "Success. No rows returned."

This creates all four tables (`profiles`, `books`, `user_books`,
`reviews`), their constraints and indexes, Row Level Security
policies, and a trigger that automatically creates a `profiles` row
whenever someone signs up.

**Optional:** Run `supabase/demo-data.sql` the same way afterward to
pre-cache four real books (The Hobbit, The Wager, Into the Wild,
Endurance) so the homepage isn't empty before your first real users
show up. This only touches the `books` cache table — it never creates
fake users, fake statuses, or fake reviews, so it's safe to run
alongside real traffic.

### Step 3 — Find your API credentials

1. In Supabase, go to **Project Settings** (gear icon) → **API**.
2. Copy the **Project URL**.
3. Copy the **anon / public** key (labeled "anon" "public" — do
   **not** use the `service_role` key, which must never be shipped to
   a browser).

### Step 4 — Configure the app

1. Open `js/config.js` in this repo.
2. Replace the placeholders:

   ```javascript
   const SUPABASE_URL = "YOUR_SUPABASE_URL";
   const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
   ```

   with the values from Step 3.

### Step 5 — Upload the files to GitHub

1. Create a new GitHub repository (e.g. `getit-gotit-readit`).
2. Upload the entire contents of this folder to the repository (via
   `git push`, GitHub Desktop, or the "Upload files" button on
   github.com).

### Step 6 — Enable GitHub Pages

1. In your GitHub repo, go to **Settings** → **Pages**.
2. Under "Build and deployment", set **Source** to **Deploy from a
   branch**.
3. Choose your default branch (usually `main`) and the `/ (root)`
   folder.
4. Click **Save**. GitHub will give you a URL like:

   ```
   https://<your-username>.github.io/<your-repo-name>/
   ```

   It can take a minute or two to go live.

### Step 7 — Point Supabase Auth at your GitHub Pages URL

Supabase needs to know your site's real URL so email confirmation and
password-reset links redirect correctly.

1. In Supabase, go to **Authentication** → **URL Configuration**.
2. Set **Site URL** to your GitHub Pages URL from Step 6, e.g.
   `https://your-username.github.io/getit-gotit-readit/`.
3. Under **Redirect URLs**, add the same URL plus a wildcard so every
   page can be a redirect target, e.g.:
   ```
   https://your-username.github.io/getit-gotit-readit/*
   ```

#### Local development vs. GitHub Pages vs. a custom domain

- **Local development**: if you open `index.html` directly from disk
  or serve it with something like `npx serve`, your URL will be
  `file://...` or `http://localhost:...`. Add that exact URL to
  Supabase's Redirect URLs too if you want auth flows (like password
  reset) to work while developing locally.
- **GitHub Pages URL**: the default `https://<username>.github.io/<repo>/`
  address — this is what most people use, and what Step 7 configures.
- **Custom domain**: if you later attach a custom domain to GitHub
  Pages (Settings → Pages → Custom domain), update the Supabase **Site
  URL** and **Redirect URLs** to match your new domain instead — the
  old GitHub Pages URL will stop being the canonical address.

You can list multiple Redirect URLs at once, so it's fine to keep your
local dev URL, your GitHub Pages URL, and a future custom domain all
registered simultaneously.

### Optional: email confirmation

By default, new Supabase projects require users to confirm their
email before they can log in. This works out of the box with this
app — after signing up, users will see a "check your email" message.
If you'd rather skip email confirmation for faster testing, go to
**Authentication** → **Providers** → **Email** and turn off "Confirm
email".

---

## 4. How Open Library is integrated

- `js/api.js` calls `https://openlibrary.org/search.json` with a
  `title=`, `author=`, `isbn=`, or general `q=` parameter, depending on
  which search mode the user picks on `search.html`.
- Each result is normalized to `{ openlibrary_work_id, title, author,
  first_publish_year, cover_url }`. Covers come from
  `https://covers.openlibrary.org/b/id/<cover_id>-M.jpg` (or a clean
  placeholder if Open Library has no cover).
- Clicking a result opens `book.html?work=<work_id>`. If nobody has
  ever added that book before, the app fetches richer detail (full
  description, larger cover, author names) from
  `https://openlibrary.org/works/<work_id>.json` directly — no
  Supabase row exists yet.
- The very first time a logged-in user clicks **Get It / Got It /
  Read It** (or leaves a review) for that book, the app calls
  `getOrCreateBook()`, which inserts one row into the Supabase `books`
  table and from then on reuses it (`book.html?id=<uuid>`). Every
  other user who touches the same book reuses that same cached row —
  Open Library is never queried twice for the same book once it's been
  added.

---

## 5. Database architecture

| Table        | Purpose                                                    |
|--------------|-------------------------------------------------------------|
| `profiles`   | One row per user: username, display name, avatar. Public.  |
| `books`      | Local cache of books the community has touched, keyed by Open Library Work ID. Public. |
| `user_books` | The core table: one row per (user, book), with a `status` of `want`/`have`/`read`. Unique per user+book. |
| `reviews`    | One optional rating+review per (user, book). Unique per user+book. |

Row Level Security is enabled on every table:
- **profiles**: anyone can read; only the owner can update.
- **books**: anyone can read; any logged-in user can create/refresh a
  cache row (no bulk catalogue import is possible from the client —
  the app only ever inserts one book at a time, on demand).
- **user_books**: visible to everyone (so counts like "23 people have
  this book" work), but only the owner can insert/update/delete their
  own rows.
- **reviews**: visible to everyone; only the author can insert/update/
  delete their own review.

Two convenience views, `book_status_counts` and `book_rating_summary`,
pre-aggregate community stats for the Book Details page.

**Designed for future growth** without a rebuild: `user_books` and
`reviews` are structured so that friends/following, activity feeds,
custom shelves, reading goals, and similar features can be layered on
top later without changing the existing schema.

---

## 6. What you need to configure manually

- [ ] `js/config.js` — your Supabase Project URL and anon key (Step 4)
- [ ] Supabase **Site URL** and **Redirect URLs** (Step 7)
- [ ] (Optional) Turn off "Confirm email" in Supabase if you want
      instant signup during testing
- [ ] (Optional) Run `supabase/demo-data.sql` for starter content

---

## 7. Testing checklist

- [ ] Load the homepage — hero, search box, and three sections render
      without errors (sections may be empty until you add books)
- [ ] Sign up with a new email, username, and password
- [ ] Confirm email if required, then log in
- [ ] Search for a book by title (try "The Hobbit"), by author (try
      "David Grann"), and by ISBN
- [ ] Open a search result's Book Details page — cover, title, author,
      year, and description (if available) all display
- [ ] Click **Get It** on a book you're not logged in for — confirm
      you're redirected to log in
- [ ] While logged in, click **Get It**, then **Got It**, then
      **Read It** on a book — confirm the status updates and the
      community counts increase
- [ ] Leave a star rating and/or written review on a book you've read
- [ ] Edit your review, then delete it
- [ ] Visit **My Books** — confirm the book appears in the right tab,
      and switching tabs works
- [ ] Change a book's status directly from **My Books**
- [ ] Visit your own **Profile** page — confirm counts and your
      Read It books and reviews appear, and your email is never shown
- [ ] Log out, then visit another user's profile via
      `profile.html?u=theirusername` — read-only, as expected
- [ ] Try the "Forgot password" flow from the login page
- [ ] Resize the browser to a phone width — confirm the nav collapses
      into the mobile menu and book grids reflow responsively
- [ ] Try searching for something with zero results — confirm a
      friendly "No books found" message appears (no raw errors)

---

## 8. Security notes

- Only the Supabase **anon/public** key ever appears in this repo's
  client-side code. The `service_role` key and your database password
  are never used by this app and should never be added to any file
  here.
- All user-specific writes are protected by Row Level Security
  policies defined in `supabase/schema.sql` — even if someone tampers
  with the client-side JavaScript, they cannot read or write another
  user's `user_books` or `reviews` rows, or edit another user's
  profile.
- Email addresses are never queried from the client and never appear
  on public profile pages.

---

## 9. What's intentionally not in this MVP

Per the product plan, these are left for later without requiring a
schema rebuild: friends/following, activity feed, recommendations,
book clubs, lending, reading goals/streaks/statistics, custom shelves,
notifications, affiliate links, and premium subscriptions. The goal of
this MVP is simply to prove that people enjoy using **Get It → Got It
→ Read It** to track their reading.
