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
