begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select has_table('public', 'account_profiles', '存在账户资料表');
select has_table('public', 'billing_customers', '存在支付客户映射表');
select has_table('public', 'billing_subscriptions', '存在订阅事实表');
select has_table('public', 'account_entitlements', '存在账户权益快照表');
select has_table('public', 'account_entitlement_overrides', '存在管理员权益覆盖表');
select has_table('public', 'billing_webhook_events', '存在支付回调幂等表');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.account_profiles'::regclass), '账户资料强制 RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.billing_customers'::regclass), '支付客户映射强制 RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.billing_subscriptions'::regclass), '订阅事实强制 RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.account_entitlements'::regclass), '权益快照强制 RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.account_entitlement_overrides'::regclass), '权益覆盖强制 RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.billing_webhook_events'::regclass), '支付回调强制 RLS');

select ok(has_table_privilege('authenticated', 'public.account_profiles', 'select'), '登录用户可以读取自己的账户资料');
select ok(has_table_privilege('authenticated', 'public.billing_subscriptions', 'select'), '登录用户可以读取自己的订阅');
select ok(has_table_privilege('authenticated', 'public.account_entitlements', 'select'), '登录用户可以读取自己的权益');
select ok(not has_table_privilege('authenticated', 'public.billing_customers', 'select'), '客户端不能读取支付客户标识');
select ok(not has_table_privilege('authenticated', 'public.account_entitlement_overrides', 'select'), '客户端不能读取管理员权益覆盖');
select ok(not has_table_privilege('authenticated', 'public.billing_webhook_events', 'select'), '客户端不能读取支付回调记录');

select * from finish();
rollback;
