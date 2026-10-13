-- =====================================================================
-- GetIt GotIt ReadIt — Migration 003: book series
-- =====================================================================
-- Adds an optional series name and number to each cached book, e.g.
--   Michael Connelly, The Concrete Blonde -> series "Harry Bosch", #3
--
-- Series belongs to the book itself (not to one user's copy), so it
-- lives on `books`, shared by everyone who tracks that book. Existing
-- RLS already lets any logged-in user refresh the book cache, which
-- covers editing these two fields.
--
-- numeric(6,2) rather than integer so in-between entries like a #2.5
-- novella can be recorded.
--
-- Purely additive and safe to re-run.
-- =====================================================================

alter table public.books add column if not exists series_name text;
alter table public.books add column if not exists series_number numeric(6,2)
  check (series_number is null or series_number >= 0);

create index if not exists idx_books_series_name on public.books (series_name);
