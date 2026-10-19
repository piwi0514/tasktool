-- タスクツール用テーブル定義
-- Supabaseの「SQL Editor」に全部貼り付けて「Run」を押してください。

-- ジャンル
create table if not exists public.genres (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#8e8e93',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- タスク
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  genre_id uuid references public.genres(id) on delete set null,
  do_date date,                      -- やる日
  due_date date,                     -- 締め切り
  priority smallint not null default 2 check (priority between 1 and 3), -- 1高 2中 3低
  memo text not null default '',
  repeat_type text not null default 'none'
    check (repeat_type in ('none','daily','weekly','weekdays','monthly')),
  repeat_days smallint[] not null default '{}',  -- 曜日指定（0=日〜6=土）
  someday boolean not null default false,        -- いつかやる
  today_added date,                  -- 手動で「今日」に入れた日
  completed boolean not null default false,
  completed_at timestamptz,
  spawned_id uuid,                   -- 繰り返しで作った次のタスク
  created_at timestamptz not null default now()
);

create index if not exists tasks_user_completed_idx on public.tasks (user_id, completed);

-- 本人だけが読み書きできるようにする
alter table public.genres enable row level security;
alter table public.tasks  enable row level security;

drop policy if exists "own genres" on public.genres;
create policy "own genres" on public.genres
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.genres to authenticated;
grant select, insert, update, delete on public.tasks  to authenticated;
