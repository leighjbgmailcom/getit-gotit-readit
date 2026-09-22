-- =====================================================================
-- GetIt GotIt ReadIt — Supabase Schema
-- =====================================================================
-- Run this entire file once in the Supabase SQL Editor (Project ->
-- SQL Editor -> New query) on a fresh project. It is safe to re-run:
-- objects are created with IF NOT EXISTS / OR REPLACE where possible,
-- but re-running will NOT wipe existing data.
--
-- Architecture summary:
--   BOOK DATA lives in `books` — a lightweight local cache of books
--   the community has touched, keyed by Open Library Work ID. We
--   never bulk-import the Open Library catalogue.
--
--   USER DATA lives in `profiles`, `user_books`, and `reviews`. All
--   user-specific rows are protected with Row Level Security (RLS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- Table: profiles
-- One row per authenticated user. id mirrors auth.users.id.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz not null default now()
);

-- Basic username sanity: lowercase letters, numbers, underscores, 3-20 chars.
alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[a-z0-9_]{3,20}$');

create index if not exists idx_profiles_username on public.profiles (username);

-- ---------------------------------------------------------------------
-- Table: books
-- A lightweight local cache of books the community has interacted
-- with. Populated on-demand the first time any user adds a book —
-- never pre-populated wholesale from Open Library.
-- ---------------------------------------------------------------------
create table if not exists public.books (
  id                    uuid primary key default uuid_generate_v4(),
  openlibrary_work_id   text not null unique,
  title                 text not null,
  author                text,
  cover_url             text,
  first_publish_year    integer,
  description           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_books_openlibrary_work_id on public.books (openlibrary_work_id);
create index if not exists idx_books_title on public.books (title);

-- ---------------------------------------------------------------------
-- Table: user_books
-- The core table: tracks each user's relationship to a book.
-- status: 'want' (GET IT) | 'have' (GOT IT) | 'read' (READ IT)
-- ---------------------------------------------------------------------
-- Note: user_id references public.profiles (not auth.users directly) so
-- that PostgREST can embed profile info (username, display_name) in
-- queries like `user_books.select('*, profiles(*)')`. profiles.id itself
-- references auth.users(id) with cascade, and a profile row is created
-- automatically for every new auth user (see handle_new_user below), so
-- this is a transparent 1:1 stand-in for the auth user.
create table if not exists public.user_books (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  book_id        uuid not null references public.books(id) on delete cascade,
  status         text not null check (status in ('want', 'have', 'read')),
  date_added     timestamptz not null default now(),
  date_started   timestamptz,
  date_finished  timestamptz,
  updated_at     timestamptz not null default now(),
  unique (user_id, book_id)
);

create index if not exists idx_user_books_user_id on public.user_books (user_id);
create index if not exists idx_user_books_book_id on public.user_books (book_id);
create index if not exists idx_user_books_status on public.user_books (status);

-- ---------------------------------------------------------------------
-- Table: reviews
-- One optional review+rating per user per book.
-- ---------------------------------------------------------------------
-- (Same rationale as user_books above: references profiles, not
-- auth.users directly, so PostgREST can embed reviewer profile info.)
create table if not exists public.reviews (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  book_id     uuid not null references public.books(id) on delete cascade,
  rating      integer check (rating between 1 and 5),
  review      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, book_id),
  -- A review must contain at least a rating or some review text.
  constraint reviews_has_content check (rating is not null or (review is not null and length(trim(review)) > 0))
);

create index if not exists idx_reviews_book_id on public.reviews (book_id);
create index if not exists idx_reviews_user_id on public.reviews (user_id);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_books_updated_at on public.books;
create trigger trg_books_updated_at
  before update on public.books
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_books_updated_at on public.user_books;
create trigger trg_user_books_updated_at
  before update on public.user_books
  for each row execute function public.set_updated_at();

drop trigger if exists trg_reviews_updated_at on public.reviews;
create trigger trg_reviews_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

-- Keep date_started / date_finished sensible as status changes.
-- Runs on both insert (e.g. a user jumps straight to "have" or "read")
-- and update (e.g. moving from "want" to "have").
create or replace function public.set_user_books_status_dates()
returns trigger as $$
begin
  if new.status in ('have', 'read') and new.date_started is null then
    new.date_started = now();
  end if;
  if new.status = 'read' and new.date_finished is null then
    new.date_finished = now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_books_status_dates on public.user_books;
create trigger trg_user_books_status_dates
  before insert or update on public.user_books
  for each row execute function public.set_user_books_status_dates();

-- ---------------------------------------------------------------------
-- Auto-create a profile row whenever a new auth user signs up.
-- Username defaults to the local part of their email; the app lets
-- them refine it in signup flow via updating profiles directly.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
declare
  base_username text;
  final_username text;
  suffix int := 0;
  requested_username text;
begin
  -- Prefer a username the client asked for at signup time
  -- (passed via supabase.auth.signUp options.data.username).
  requested_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', ''), '[^a-z0-9_]', '_', 'g'));

  if requested_username is not null and length(requested_username) >= 3 then
    base_username := requested_username;
  else
    base_username := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9_]', '_', 'g'));
  end if;

  if base_username is null or length(base_username) < 3 then
    base_username := 'reader_' || substr(new.id::text, 1, 8);
  end if;
  final_username := base_username;

  while exists (select 1 from public.profiles where username = final_username) loop
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, final_username, coalesce(new.raw_user_meta_data->>'display_name', base_username));

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.user_books enable row level security;
alter table public.reviews enable row level security;

-- ---------------------------------------------------------------------
-- profiles policies
-- Public profiles are viewable by anyone (no email exposed — email
-- lives only in auth.users, which is never queried from the client).
-- Users may only edit their own profile.
-- ---------------------------------------------------------------------
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Insert is normally handled by the handle_new_user trigger, but we
-- allow a user to insert their own row defensively (e.g. if the
-- trigger's row was somehow missing).
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------
-- books policies
-- Book data is cached catalogue info, not user data: anyone (including
-- anonymous visitors) can read it. Any authenticated user can create a
-- cache row when they're the first to touch a given book. Nobody
-- outside the row's own trigger updates it except authenticated users
-- refreshing stale metadata (kept permissive for MVP simplicity).
-- ---------------------------------------------------------------------
drop policy if exists "Books are viewable by everyone" on public.books;
create policy "Books are viewable by everyone"
  on public.books for select
  using (true);

drop policy if exists "Authenticated users can cache books" on public.books;
create policy "Authenticated users can cache books"
  on public.books for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can refresh book cache" on public.books;
create policy "Authenticated users can refresh book cache"
  on public.books for update
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- user_books policies
-- For MVP social features, status rows are visible to everyone
-- (e.g. "23 people have this book"), but only the owner can create,
-- update, or delete their own rows.
-- ---------------------------------------------------------------------
drop policy if exists "User books are viewable by everyone" on public.user_books;
create policy "User books are viewable by everyone"
  on public.user_books for select
  using (true);

drop policy if exists "Users can add own books" on public.user_books;
create policy "Users can add own books"
  on public.user_books for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own books" on public.user_books;
create policy "Users can update own books"
  on public.user_books for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own books" on public.user_books;
create policy "Users can delete own books"
  on public.user_books for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- reviews policies
-- Reviews are public to read; only the author can create/edit/delete
-- their own review.
-- ---------------------------------------------------------------------
drop policy if exists "Reviews are viewable by everyone" on public.reviews;
create policy "Reviews are viewable by everyone"
  on public.reviews for select
  using (true);

drop policy if exists "Users can create own reviews" on public.reviews;
create policy "Users can create own reviews"
  on public.reviews for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own reviews" on public.reviews;
create policy "Users can update own reviews"
  on public.reviews for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own reviews" on public.reviews;
create policy "Users can delete own reviews"
  on public.reviews for delete
  to authenticated
  using (auth.uid() = user_id);

-- =====================================================================
-- Convenience views (used by the homepage for lightweight "community"
-- queries — plain SQL, no recommendation engine).
-- =====================================================================
create or replace view public.book_status_counts as
select
  book_id,
  count(*) filter (where status = 'want') as want_count,
  count(*) filter (where status = 'have') as have_count,
  count(*) filter (where status = 'read') as read_count,
  count(*) as total_count
from public.user_books
group by book_id;

create or replace view public.book_rating_summary as
select
  book_id,
  round(avg(rating)::numeric, 2) as average_rating,
  count(rating) as rating_count,
  count(review) filter (where review is not null and length(trim(review)) > 0) as review_count
from public.reviews
group by book_id;

-- =====================================================================
-- End of schema. Next: optionally run supabase/demo-data.sql.
-- =====================================================================
