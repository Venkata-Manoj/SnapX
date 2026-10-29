-- SnapX accounts and billing schema.
--
-- Run this in the Supabase SQL editor for the project the site points at.
-- It is idempotent: safe to run again after edits. It creates the tables the
-- site reads, a trigger that gives every new user a Free plan row, a
-- payment-events ledger for Razorpay webhook idempotency, and row-level
-- security so a signed-in user can read only their own rows.
--
-- The browser uses the publishable key and never writes these tables. The
-- Edge Functions (create-subscription, razorpay-webhook, cancel-subscription,
-- change-subscription, delete-account, entitlement) write with the
-- service-role key, which bypasses RLS by design.

-- ---------- Profiles (display data copied from the sign-in provider) ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();

-- ---------- Subscriptions (one row per user) ----------

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'active',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider_subscription_id text,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions add column if not exists plan text not null default 'free';
alter table public.subscriptions add column if not exists status text not null default 'active';
alter table public.subscriptions add column if not exists current_period_end timestamptz;
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.subscriptions add column if not exists provider_subscription_id text;
alter table public.subscriptions add column if not exists updated_at timestamptz not null default now();

-- Billing details written only by the Edge Functions.
alter table public.subscriptions add column if not exists provider_plan_id text;
alter table public.subscriptions add column if not exists started_at timestamptz;
alter table public.subscriptions add column if not exists pending_plan text;
alter table public.subscriptions add column if not exists pending_plan_at timestamptz;
alter table public.subscriptions add column if not exists last_payment_at timestamptz;
alter table public.subscriptions add column if not exists last_payment_amount integer;
alter table public.subscriptions add column if not exists last_payment_currency text;

create unique index if not exists subscriptions_provider_subscription_id_key
  on public.subscriptions (provider_subscription_id)
  where provider_subscription_id is not null;

-- ---------- Payment events (webhook idempotency ledger) ----------
--
-- One row per Razorpay event, keyed by the X-Razorpay-Event-Id header. The
-- payload is minimised to the billing fields we need for reconciliation: no
-- customer name, email, phone, card or UPI data is stored. user_id is set to
-- null by the foreign key when an account is deleted, so the payment record
-- survives for tax purposes without identifying the person.

create table if not exists public.payment_events (
  id text primary key,
  event text not null,
  user_id uuid references auth.users (id) on delete set null,
  provider_subscription_id text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

alter table public.payment_events add column if not exists event text;
alter table public.payment_events add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.payment_events add column if not exists provider_subscription_id text;
alter table public.payment_events add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.payment_events add column if not exists received_at timestamptz not null default now();
alter table public.payment_events add column if not exists processed_at timestamptz;
alter table public.payment_events add column if not exists error text;

create index if not exists payment_events_user_id_idx on public.payment_events (user_id);
create index if not exists payment_events_subscription_idx
  on public.payment_events (provider_subscription_id);

-- ---------- updated_at ----------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- ---------- New user -> profile + Free plan ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before the trigger existed.
insert into public.profiles (id, email, full_name, avatar_url)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
  coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
on conflict (id) do nothing;

insert into public.subscriptions (user_id, plan, status)
select u.id, 'free', 'active'
from auth.users u
on conflict (user_id) do nothing;

-- ---------- Row-level security ----------

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Read own subscription" on public.subscriptions;
create policy "Read own subscription"
  on public.subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;
revoke all on public.profiles from anon;
revoke all on public.subscriptions from anon;

-- The payment ledger has no browser policy at all: service-role only.
revoke all on public.payment_events from anon;
revoke all on public.payment_events from authenticated;

-- Writes are intentionally not granted to anon or authenticated. The payment
-- webhook and the account functions use the service-role key server-side.
