-- Subscription and account-center foundation. Payment providers remain server-side;
-- clients can only read the normalized state that belongs to their Supabase user.

create table public.account_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  avatar_path text,
  locale text not null default 'zh-CN' check (locale in ('zh-CN')),
  timezone text not null default 'Asia/Shanghai' check (char_length(timezone) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_customers (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('stripe')),
  provider_customer_id text not null,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider),
  unique (provider, provider_customer_id)
);

create table public.billing_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('stripe')),
  provider_subscription_id text not null,
  provider_price_id text not null,
  plan_key text not null check (plan_key in ('plus', 'pro')),
  status text not null check (
    status in (
      'incomplete', 'trialing', 'active', 'past_due', 'paused', 'unpaid',
      'canceled', 'incomplete_expired'
    )
  ),
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  grace_until timestamptz,
  provider_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create index billing_subscriptions_user_idx
  on public.billing_subscriptions (user_id, updated_at desc);

create unique index billing_subscriptions_one_current_idx
  on public.billing_subscriptions (user_id)
  where status in ('incomplete', 'trialing', 'active', 'past_due', 'paused');

create table public.account_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_key text not null default 'free' check (plan_key in ('free', 'plus', 'pro')),
  source text not null default 'free' check (source in ('free', 'subscription', 'admin_override')),
  subscription_status text not null default 'none' check (
    subscription_status in (
      'none', 'incomplete', 'trialing', 'active', 'past_due', 'paused', 'unpaid',
      'canceled', 'incomplete_expired'
    )
  ),
  action_daily_limit integer not null default 10 check (action_daily_limit between 1 and 100000),
  action_period_limit integer not null default 45 check (action_period_limit between 1 and 1000000),
  image_daily_limit integer not null default 2 check (image_daily_limit between 1 and 10000),
  image_period_limit integer not null default 20 check (image_period_limit between 1 and 100000),
  max_boards integer not null default 100 check (max_boards between 1 and 100000),
  max_storage_bytes bigint not null default 1073741824 check (max_storage_bytes > 0),
  max_concurrent_ai_tasks integer not null default 3 check (max_concurrent_ai_tasks between 1 and 100),
  model_quality_tier text not null default 'standard'
    check (model_quality_tier in ('standard', 'enhanced', 'premium')),
  unlimited boolean not null default false,
  effective_until timestamptz,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_entitlement_overrides (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_key text not null check (plan_key in ('free', 'plus', 'pro')),
  reason text not null check (char_length(reason) between 3 and 500),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create index account_entitlement_overrides_active_idx
  on public.account_entitlement_overrides (user_id, expires_at desc);

create table public.billing_webhook_events (
  provider text not null check (provider in ('stripe')),
  event_id text not null,
  event_type text not null,
  object_id text,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'received' check (status in ('received', 'processed', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 100),
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);

create trigger account_profiles_set_updated_at before update on public.account_profiles
for each row execute function public.set_updated_at();
create trigger billing_customers_set_updated_at before update on public.billing_customers
for each row execute function public.set_updated_at();
create trigger billing_subscriptions_set_updated_at before update on public.billing_subscriptions
for each row execute function public.set_updated_at();
create trigger account_entitlements_set_updated_at before update on public.account_entitlements
for each row execute function public.set_updated_at();

create function public.initialize_account_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.account_entitlements (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger initialize_account_records_after_signup
after insert on auth.users
for each row execute function public.initialize_account_records();

insert into public.account_profiles (user_id)
select id from auth.users
on conflict do nothing;

insert into public.account_entitlements (user_id)
select id from auth.users
on conflict do nothing;

alter table public.account_profiles enable row level security;
alter table public.account_profiles force row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_customers force row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_subscriptions force row level security;
alter table public.account_entitlements enable row level security;
alter table public.account_entitlements force row level security;
alter table public.account_entitlement_overrides enable row level security;
alter table public.account_entitlement_overrides force row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.billing_webhook_events force row level security;

create policy account_profiles_select_own on public.account_profiles
for select to authenticated using ((select auth.uid()) = user_id);
create policy billing_subscriptions_select_own on public.billing_subscriptions
for select to authenticated using ((select auth.uid()) = user_id);
create policy account_entitlements_select_own on public.account_entitlements
for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.account_profiles from anon, authenticated;
revoke all on table public.billing_customers from anon, authenticated;
revoke all on table public.billing_subscriptions from anon, authenticated;
revoke all on table public.account_entitlements from anon, authenticated;
revoke all on table public.account_entitlement_overrides from anon, authenticated;
revoke all on table public.billing_webhook_events from anon, authenticated;

grant select on table public.account_profiles to authenticated;
grant select on table public.billing_subscriptions to authenticated;
grant select on table public.account_entitlements to authenticated;

grant all on table public.account_profiles to service_role;
grant all on table public.billing_customers to service_role;
grant all on table public.billing_subscriptions to service_role;
grant all on table public.account_entitlements to service_role;
grant all on table public.account_entitlement_overrides to service_role;
grant all on table public.billing_webhook_events to service_role;

revoke all on function public.initialize_account_records() from public, anon, authenticated;
grant execute on function public.initialize_account_records() to service_role;
