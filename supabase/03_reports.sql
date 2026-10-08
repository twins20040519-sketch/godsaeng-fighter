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
