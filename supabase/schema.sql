-- Run this in the Supabase SQL editor

-- A course = a product in BigCommerce.
-- To add a new course: create the product in BigCommerce, then
-- insert a row here with its product_id. No code changes needed.
create table courses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,               -- used in the URL: /course/[slug]
  title text not null,
  description text,
  bigcommerce_product_id integer unique not null,
  created_at timestamptz default now()
);

-- Lessons for each course, grouped into chapters (module_title), in order.
-- A lesson is either a YouTube video or a PDF in Google Drive: the Evolve
-- course is about three-quarters video, with the manual, consultation form,
-- adhesive charts and aftercare guides as documents.
create table course_videos (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade,
  module_title text not null default 'Lessons',  -- chapter heading, e.g. "The Consultation"
  title text not null,
  source_id text not null,                 -- YouTube video ID, or Google Drive file ID
  source_type text not null default 'youtube'
    check (source_type in ('youtube', 'pdf')),
  position integer not null default 0,     -- order across the whole course
  created_at timestamptz default now()
);

-- Filled automatically by the BigCommerce webhook when someone buys a course.
create table purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  course_id uuid references courses(id) on delete cascade,
  bigcommerce_order_id integer not null,
  purchased_at timestamptz default now(),
  unique(user_id, course_id)
);

-- Row Level Security: each user only sees their own purchases.
alter table purchases enable row level security;

create policy "users can see their own purchases"
  on purchases for select
  using (auth.uid() = user_id);

-- courses and course_videos are public for reading (the real access
-- gating happens when the video is served: see /app/course/[slug]/page.tsx)
alter table courses enable row level security;
alter table course_videos enable row level security;

create policy "anyone can see the course catalog"
  on courses for select using (true);

-- Lessons are readable only by someone who owns the course they belong to.
--
-- This was `using (true)` until an outside QA pass caught it. The anon key
-- is public by design — it ships in every page — so that policy made every
-- lesson's source_id world-readable, and an unlisted YouTube id is the
-- capability to watch the video. 234 lessons of paid content were readable
-- by anyone who thought to ask.
--
-- Staff are not special-cased: they are granted every course when they are
-- given access, so they satisfy this the same way a student does. Admin
-- screens read through the service-role key, which bypasses RLS entirely.
create policy "students see lessons of courses they own"
  on course_videos for select
  using (
    exists (
      select 1 from purchases p
      where p.user_id = auth.uid()
        and p.course_id = course_videos.course_id
    )
  );

-- Staff who can manage courses through /admin. Two layers: the emails in
-- the ADMIN_EMAILS env var are permanent (they cannot be removed through
-- the UI, so nobody can lock everyone out), and rows here are managed by
-- staff themselves.
create table admins (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  added_by text,
  created_at timestamptz default now()
);

-- RLS on with NO policies: only the service-role key can read or write
-- this list, so the staff roster is never exposed to the browser.
alter table admins enable row level security;

-- Which lessons a student has ticked off. Completion used to live in React
-- state and nowhere else, so it reset on every page load and a student part
-- way through the course saw it back at zero each visit.
--
-- One row per lesson completed, keyed on the pair so re-ticking is a no-op
-- rather than a duplicate.
create table lesson_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references course_videos(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

-- Written by the student's own browser, so the policies are what stops one
-- student reading or editing another's progress.
alter table lesson_progress enable row level security;

create policy "users can see their own progress"
  on lesson_progress for select using (auth.uid() = user_id);

create policy "users can record their own progress"
  on lesson_progress for insert with check (auth.uid() = user_id);

create policy "users can clear their own progress"
  on lesson_progress for delete using (auth.uid() = user_id);
