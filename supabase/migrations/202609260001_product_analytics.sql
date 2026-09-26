-- 第一方匿名产品统计：只保留日聚合和不可逆访客摘要。

create table public.analytics_daily_metrics (
  day date primary key,
  page_views bigint not null default 0 check (page_views >= 0),
  visits bigint not null default 0 check (visits >= 0),
  unique_visitors bigint not null default 0 check (unique_visitors >= 0),
  updated_at timestamptz not null default now()
);

create table public.analytics_daily_visitors (
  day date not null,
  visitor_hash text not null check (visitor_hash ~ '^[a-f0-9]{64}$'),
  last_seen_at timestamptz not null,
  primary key (day, visitor_hash)
);

create index analytics_daily_visitors_seen_idx
on public.analytics_daily_visitors (last_seen_at);

alter table public.analytics_daily_metrics enable row level security;
alter table public.analytics_daily_metrics force row level security;
alter table public.analytics_daily_visitors enable row level security;
alter table public.analytics_daily_visitors force row level security;

revoke all on table public.analytics_daily_metrics from anon, authenticated;
revoke all on table public.analytics_daily_visitors from anon, authenticated;
grant all on table public.analytics_daily_metrics to service_role;
grant all on table public.analytics_daily_visitors to service_role;

create function public.record_analytics_visit(
  p_visitor_hash text,
  p_seen_at timestamptz default pg_catalog.now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (p_seen_at at time zone 'UTC')::date;
  v_inserted integer := 0;
  v_previous_seen timestamptz;
  v_new_session bigint := 0;
begin
  if p_visitor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_VISITOR_HASH' using errcode = '22023';
  end if;

  insert into public.analytics_daily_visitors (day, visitor_hash, last_seen_at)
  values (v_day, p_visitor_hash, p_seen_at)
  on conflict (day, visitor_hash) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    v_new_session := 1;
  else
    select last_seen_at
    into v_previous_seen
    from public.analytics_daily_visitors
    where day = v_day and visitor_hash = p_visitor_hash
    for update;

    if v_previous_seen <= p_seen_at - interval '30 minutes' then
      v_new_session := 1;
    end if;

    update public.analytics_daily_visitors
    set last_seen_at = pg_catalog.greatest(last_seen_at, p_seen_at)
    where day = v_day and visitor_hash = p_visitor_hash;
  end if;

  insert into public.analytics_daily_metrics (
    day,
    page_views,
    visits,
    unique_visitors,
    updated_at
  ) values (
    v_day,
    1,
    v_new_session,
    v_inserted,
    pg_catalog.now()
  )
  on conflict (day) do update
  set page_views = public.analytics_daily_metrics.page_views + 1,
      visits = public.analytics_daily_metrics.visits + excluded.visits,
      unique_visitors = public.analytics_daily_metrics.unique_visitors + excluded.unique_visitors,
      updated_at = pg_catalog.now();
end;
$$;

create function public.get_public_product_metrics()
returns table (
  total_visits bigint,
  visitors_30d bigint,
  registered_users bigint,
  cloud_boards bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(visits) from public.analytics_daily_metrics), 0)::bigint,
    (
      select count(distinct visitor_hash)
      from public.analytics_daily_visitors
      where day >= (current_date - 29)
    )::bigint,
    (select count(*) from auth.users)::bigint,
    (select count(*) from public.boards)::bigint;
$$;

create or replace function public.purge_expired_operational_records()
returns table (feedback_deleted bigint, audit_deleted bigint, cleanup_jobs_deleted bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.ai_feedback
  where created_at < pg_catalog.now() - interval '90 days';
  get diagnostics feedback_deleted = row_count;

  delete from public.security_audit_events
  where created_at < pg_catalog.now() - interval '180 days';
  get diagnostics audit_deleted = row_count;

  delete from public.asset_cleanup_jobs
  where status = 'completed'
    and updated_at < pg_catalog.now() - interval '30 days';
  get diagnostics cleanup_jobs_deleted = row_count;

  delete from public.analytics_daily_visitors
  where day < current_date - 90;

  return next;
end;
$$;

revoke all on function public.record_analytics_visit(text, timestamptz)
from public, anon, authenticated;
revoke all on function public.get_public_product_metrics()
from public, anon, authenticated;
grant execute on function public.record_analytics_visit(text, timestamptz) to service_role;
grant execute on function public.get_public_product_metrics() to service_role;
