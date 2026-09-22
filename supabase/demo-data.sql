-- =====================================================================
-- GetIt GotIt ReadIt — Optional Demo Data
-- =====================================================================
-- This script is OPTIONAL. Run it only if you want a few real books
-- pre-cached so the site doesn't feel empty before your first real
-- users search for anything.
--
-- It only inserts rows into `books` (the local metadata cache). It
-- does NOT create any fake users, fake `user_books` statuses, or fake
-- reviews — those tables reference real auth.users rows, and creating
-- fake ones would require inserting directly into Supabase's internal
-- auth schema, which is unsafe and unsupported. Real "23 people have
-- this book" counts will appear naturally once real users add books.
--
-- Safe to run multiple times (upserts on the unique
-- openlibrary_work_id). Safe to run alongside real user activity —
-- it never touches user_books, reviews, or profiles.
--
-- Run this AFTER supabase/schema.sql.
-- =====================================================================

insert into public.books (openlibrary_work_id, title, author, cover_url, first_publish_year, description)
values
  (
    'OL262758W',
    'The Hobbit',
    'J.R.R. Tolkien',
    'https://covers.openlibrary.org/b/olid/OL22856696M-L.jpg',
    1937,
    'Bilbo Baggins is a hobbit who enjoys a comfortable, unambitious life, rarely traveling farther than his pantry or cellar. But his contentment is disturbed when the wizard Gandalf and a company of dwarves arrive on his doorstep to whisk him away on a quest.'
  ),
  (
    'OL20066628W',
    'The Wager: A Tale of Shipwreck, Mutiny and Murder',
    'David Grann',
    'https://covers.openlibrary.org/b/olid/OL37528263M-L.jpg',
    2023,
    'On a remote island off the coast of Patagonia, more than eighty survivors of a shipwrecked British vessel washed ashore. What happened to them defines a harrowing and true story of human nature, pushed to its extremes.'
  ),
  (
    'OL675783W',
    'Into the Wild',
    'Jon Krakauer',
    'https://covers.openlibrary.org/b/olid/OL7358996M-L.jpg',
    1996,
    'In April 1992 a young man from a well-to-do family hitchhiked to Alaska and walked alone into the wilderness north of Mt. McKinley. His name was Christopher Johnson McCandless. Four months later, his decomposed body was found by a moose hunter.'
  ),
  (
    'OL1194594W',
    'Endurance: Shackleton''s Incredible Voyage',
    'Alfred Lansing',
    'https://covers.openlibrary.org/b/olid/OL7929211M-L.jpg',
    1959,
    'In August 1914, Sir Ernest Shackleton and a crew of twenty-seven set sail for the South Atlantic aboard the Endurance. Nineteen months later, stranded amid the ice floes, the crew was forced to make a heart-rending journey over pack ice and mountainous seas.'
  )
on conflict (openlibrary_work_id) do update
set
  title = excluded.title,
  author = excluded.author,
  cover_url = excluded.cover_url,
  first_publish_year = excluded.first_publish_year,
  description = excluded.description;

-- =====================================================================
-- That's it. Sign up a real account and use "GET IT / GOT IT / READ IT"
-- on these books from the app to see real user_books rows appear.
-- =====================================================================
