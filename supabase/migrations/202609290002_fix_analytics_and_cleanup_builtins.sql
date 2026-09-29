-- 修复把 SQL 特殊表达式 GREATEST/LEAST 当作 pg_catalog 函数调用的问题。
-- PostgreSQL 会将 pg_catalog.greatest/least 解析为不存在的普通函数（42883）。

create or replace function public.record_analytics_visit(
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
    set last_seen_at = greatest(last_seen_at, p_seen_at)
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

create or replace function public.enqueue_account_asset_cleanup(
  p_user_id uuid,
  p_not_before timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queued bigint;
begin
  insert into public.asset_cleanup_jobs (
    object_path,
    reason,
    not_before,
    status,
    attempts,
    last_error_code
  )
  select
    asset.object_path,
    'account_deleted',
    p_not_before,
    'pending',
    0,
    null
  from public.board_assets as asset
  join public.boards as board on board.id = asset.board_id
  where board.owner_id = p_user_id
  on conflict (object_path) do update
  set reason = excluded.reason,
      not_before = least(public.asset_cleanup_jobs.not_before, excluded.not_before),
      status = 'pending',
      attempts = 0,
      last_error_code = null,
      updated_at = pg_catalog.now();

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

