-- ============================================================
-- GODSAENG FIGHTER 서버 설정
-- Supabase 대시보드 → SQL Editor → New query 에 전부 붙여넣고 Run
-- ============================================================

-- 1) 프로필: 닉네임과 사용 중인 캐릭터
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 12),
  char text not null default 'rookie',
  created_at timestamptz not null default now()
);

-- 2) 배틀 방
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique,                                   -- 친구방 초대 코드 (GS-XXXX)
  type text not null check (type in ('dawn','book','iron','study')),
  mode text not null check (mode in ('friend','duel','royale')),
  day date not null default ((now() at time zone 'Asia/Seoul')::date),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 3) 방 참가자
create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- 4) 하루 기록 (종목마다 하나)
create table if not exists public.records (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  day date not null,
  type text not null check (type in ('dawn','book','iron','study')),
  value integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, day, type)
);

-- ===== 보안 규칙: 로그인한 사람만, 내 것만 고칠 수 있어요 =====
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.records enable row level security;

drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles write own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles write own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid());

drop policy if exists "rooms read" on public.rooms;
drop policy if exists "rooms create" on public.rooms;
create policy "rooms read" on public.rooms for select to authenticated using (true);
create policy "rooms create" on public.rooms for insert to authenticated with check (created_by = auth.uid() and mode = 'friend');

drop policy if exists "members read" on public.room_members;
drop policy if exists "members join self" on public.room_members;
drop policy if exists "members leave self" on public.room_members;
create policy "members read" on public.room_members for select to authenticated using (true);
create policy "members join self" on public.room_members for insert to authenticated with check (user_id = auth.uid());
create policy "members leave self" on public.room_members for delete to authenticated using (user_id = auth.uid());

drop policy if exists "records read" on public.records;
drop policy if exists "records write own" on public.records;
drop policy if exists "records update own" on public.records;
create policy "records read" on public.records for select to authenticated using (true);
create policy "records write own" on public.records for insert to authenticated with check (user_id = auth.uid());
create policy "records update own" on public.records for update to authenticated using (user_id = auth.uid());

-- ===== 랜덤 매칭: 같은 종목·방식·날짜의 빈자리 방에 넣고, 없으면 새로 만들어요 =====
create or replace function public.join_random(p_type text, p_mode text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cap int := case p_mode when 'duel' then 2 when 'royale' then 11 else 0 end;
  today date := (now() at time zone 'Asia/Seoul')::date;
  rid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if cap = 0 or p_type not in ('dawn','book','iron','study') then raise exception 'bad mode'; end if;

  -- 이미 오늘 이 종목·방식 방에 있으면 그 방
  select r.id into rid from rooms r join room_members m on m.room_id = r.id
   where r.type = p_type and r.mode = p_mode and r.day = today and m.user_id = auth.uid() limit 1;
  if rid is not null then return rid; end if;

  -- 빈자리 있는 방 찾기
  select r.id into rid from rooms r
   where r.type = p_type and r.mode = p_mode and r.day = today
     and (select count(*) from room_members m where m.room_id = r.id) < cap
   order by r.created_at
   limit 1
   for update skip locked;

  if rid is null then
    insert into rooms(type, mode, day, created_by) values (p_type, p_mode, today, auth.uid()) returning id into rid;
  end if;

  insert into room_members(room_id, user_id) values (rid, auth.uid()) on conflict do nothing;
  return rid;
end;
$$;

grant execute on function public.join_random(text, text) to authenticated;
-- ============================================================
-- 계정 삭제 기능 (Apple 심사 필수)
-- SQL Editor → New query 에 붙여넣고 Run
-- 내 계정을 지우면 프로필·방 참가·기록이 모두 함께 지워져요
-- ============================================================
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
-- ============================================================
-- 신고 기능 (Apple 심사: 사용자 생성 콘텐츠 신고)
-- SQL Editor → New query 에 붙여넣고 Run
-- 신고 내용은 Supabase → Table Editor → reports 에서 볼 수 있어요
-- ============================================================
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reported uuid not null,
  nickname text,
  reason text not null default 'inappropriate_nickname',
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "reports create own" on public.reports;
create policy "reports create own" on public.reports for insert to authenticated with check (reporter = auth.uid());
-- 신고 목록은 앱에서 읽을 수 없고, 운영자만 Supabase 대시보드에서 봐요
