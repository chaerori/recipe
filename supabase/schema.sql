-- Supabase 대시보드 > SQL Editor 에 붙여 넣고 한 번 실행하세요.
-- 모든 테이블은 로그인한 계정의 행만 읽고 쓸 수 있도록 행 수준 보안(RLS)을 켭니다.

create table if not exists ingredients (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  qty         double precision not null default 1,
  unit        text not null default '개',
  storage     text not null default '냉장',
  expiry      date,
  expiry_est  integer not null default 0,
  added_at    date not null default current_date
);
create table if not exists staples (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name    text not null,
  unique (user_id, name)
);
create table if not exists avoid (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name    text not null,
  unique (user_id, name)
);
create table if not exists cook_log (
  id        bigint generated always as identity primary key,
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id integer not null,
  cooked_at text not null,
  note      text
);
create table if not exists shopping (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name    text not null,
  done    boolean not null default false,
  unique (user_id, name)
);

-- 만개의레시피 레시피 목록 (공개 파일이 아니라 로그인해야 읽을 수 있는 곳에 둡니다)
create table if not exists recipes (
  id           integer primary key,
  title        text not null,
  image        text,
  rating       double precision not null,
  review_count integer not null default 0,
  category     text not null,
  time         text,
  servings     text,
  ingredients  jsonb not null default '[]'
);
alter table recipes enable row level security;
drop policy if exists "signed-in only" on recipes;
create policy "signed-in only" on recipes for all to authenticated using (true) with check (true);

-- 내가 직접 적은 레시피
create table if not exists my_recipes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null,
  category    text not null default '메인요리',
  time        text,
  servings    text,
  description text,
  source_url  text,
  ingredients jsonb not null default '[]',
  steps       jsonb not null default '[]'
);

-- 만개의레시피 레시피의 조리 순서·설명 (공개 파일이 아니라 로그인해야 읽을 수 있는 곳에 둡니다)
create table if not exists recipe_details (
  recipe_id   integer primary key,
  description text,
  steps       jsonb not null default '[]'
);
alter table recipe_details enable row level security;
drop policy if exists "signed-in only" on recipe_details;
create policy "signed-in only" on recipe_details for all to authenticated using (true) with check (true);

do $$
declare t text;
begin
  foreach t in array array['ingredients', 'staples', 'avoid', 'cook_log', 'shopping', 'my_recipes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('create policy "own rows" on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
