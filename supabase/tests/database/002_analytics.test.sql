begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('public', 'analytics_daily_metrics', '存在访问日聚合表');
select has_table('public', 'analytics_daily_visitors', '存在匿名访客摘要表');
select has_function(
  'public',
  'record_analytics_visit',
  array['text', 'timestamp with time zone'],
  '存在访问记录 RPC'
);
select has_function(
  'public',
  'get_public_product_metrics',
  array[]::text[],
  '存在公开产品指标 RPC'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.analytics_daily_metrics'::regclass
  ),
  '访问日聚合表启用并强制 RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.analytics_daily_visitors'::regclass
  ),
  '匿名访客摘要表启用并强制 RLS'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.record_analytics_visit(text, timestamp with time zone)',
    'execute'
  ),
  '游客不能直接写访问统计'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_analytics_visit(text, timestamp with time zone)',
    'execute'
  ),
  '服务端角色可以写访问统计'
);
select ok(
  not has_function_privilege('anon', 'public.get_public_product_metrics()', 'execute'),
  '游客不能绕过服务端读取聚合数据'
);
select ok(
  has_function_privilege('service_role', 'public.get_public_product_metrics()', 'execute'),
  '服务端角色可以读取聚合数据'
);

select lives_ok(
  $$
    select public.record_analytics_visit(
      repeat('a', 64),
      '2026-09-26 00:00:00+00'::timestamptz
    );
    select public.record_analytics_visit(
      repeat('a', 64),
      '2026-09-26 00:10:00+00'::timestamptz
    );
    select public.record_analytics_visit(
      repeat('a', 64),
      '2026-09-26 00:41:00+00'::timestamptz
    );
  $$,
  '重复浏览可以安全合并为会话'
);
select is(
  (select page_views from public.analytics_daily_metrics where day = '2026-09-26'),
  3::bigint,
  '同一访客的三次页面打开均计入浏览量'
);
select is(
  (select visits from public.analytics_daily_metrics where day = '2026-09-26'),
  2::bigint,
  '30 分钟内的重复访问合并为一次会话'
);
select is(
  (select unique_visitors from public.analytics_daily_metrics where day = '2026-09-26'),
  1::bigint,
  '同一天同一访客只计一次独立访客'
);
select is(
  (select total_visits from public.get_public_product_metrics()),
  2::bigint,
  '公开指标返回累计会话数'
);

insert into public.analytics_daily_visitors (day, visitor_hash, last_seen_at)
values (
  current_date - 91,
  repeat('b', 64),
  pg_catalog.now() - interval '91 days'
);
select lives_ok(
  $$select * from public.purge_expired_operational_records()$$,
  '运行数据清理任务可以处理过期访客摘要'
);
select is(
  (select count(*) from public.analytics_daily_visitors where visitor_hash = repeat('b', 64)),
  0::bigint,
  '超过 90 天的访客摘要已删除'
);

select * from finish();
rollback;
