-- Supabase keep-alive heartbeat.
--
-- The GitHub Action reads this table through PostgREST with the anon key once
-- every Monday and Thursday. It is deliberately read-only from the browser:
-- anon may SELECT the single row and may not insert, update or delete it.

create table if not exists public.keepalive (
  id integer primary key,
  note text
);

alter table public.keepalive enable row level security;

insert into public.keepalive (id, note)
values (1, 'Supabase keep-alive heartbeat row.')
on conflict (id) do nothing;

revoke all on public.keepalive from anon, authenticated;
grant select on public.keepalive to anon;
grant all on public.keepalive to service_role;

drop policy if exists "Keepalive read" on public.keepalive;
create policy "Keepalive read"
  on public.keepalive for select
  to anon
  using (true);
