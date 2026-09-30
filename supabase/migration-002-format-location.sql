-- =====================================================================
-- GetIt GotIt ReadIt — Migration 002: format + location on user_books
-- =====================================================================
-- Only needed if your project was set up BEFORE this migration existed
-- (schema.sql already includes these columns for a fresh install).
-- Safe to re-run — every statement is idempotent.
--
-- Adds:
--   user_books.format   — how the user has/reads this book (Paper,
--                          Kindle, Libby, Hoopla, Cloud Library, Apple
--                          Books (PDF), Downloads Folder, Memory Stick,
--                          Other, or NULL if unset)
--   user_books.location — free-text note on where a copy lives (a
--                          shelf, a device, a folder) — optional,
--                          user-defined, no fixed format
--
-- Run this in the Supabase SQL Editor on an existing project.
-- =====================================================================

alter table public.user_books
  add column if not exists format text,
  add column if not exists location text;

alter table public.user_books
  drop constraint if exists user_books_format_check;
alter table public.user_books
  add constraint user_books_format_check
  check (
    format is null or format in (
      'Paper', 'Kindle', 'Libby', 'Hoopla', 'Cloud Library',
      'Apple Books (PDF)', 'Downloads Folder', 'Memory Stick', 'Other'
    )
  );

comment on column public.user_books.format is 'How the user has/reads this book (only meaningful once they have or have read it). One of a fixed set of options, or NULL if unset.';
comment on column public.user_books.location is 'Free-text note on where this physical/digital copy lives (e.g. a shelf, a device, a folder). Optional, user-defined.';
