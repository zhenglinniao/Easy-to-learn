begin;

create extension if not exists pgtap with schema extensions;
select plan(40);

select has_table('public', 'boards', '存在 boards 表');
select has_table('public', 'board_assets', '存在 board_assets 表');
select has_table('public', 'account_deletion_requests', '存在账户删除表');
select has_table('public', 'ai_feedback', '存在 AI 反馈表');
select has_table('public', 'security_audit_events', '存在安全审计表');
select has_table('public', 'asset_cleanup_jobs', '存在资产清理任务表');

select has_function('public', 'create_board', array['text'], '存在 create_board RPC');
select has_function('public', 'rename_board', array['uuid', 'text'], '存在 rename_board RPC');
select has_function(
  'public',
  'save_board',
  array['uuid', 'bigint', 'jsonb', 'jsonb', 'text'],
  '存在 save_board RPC'
);
select has_function('public', 'delete_board', array['uuid'], '存在 delete_board RPC');
select has_function(
  'public',
  'purge_expired_operational_records',
  array[]::text[],
  '存在运行数据保留期清理函数'
);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.boards'::regclass),
  'boards 启用并强制 RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.board_assets'::regclass),
  'board_assets 启用并强制 RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.account_deletion_requests'::regclass
  ),
  'account_deletion_requests 启用并强制 RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.ai_feedback'::regclass),
  'ai_feedback 启用并强制 RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.security_audit_events'::regclass
  ),
  'security_audit_events 启用并强制 RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.asset_cleanup_jobs'::regclass
  ),
  'asset_cleanup_jobs 启用并强制 RLS'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'user-a@example.test',
    '',
    now(),
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'user-b@example.test',
    '',
    now(),
    now(),
    now()
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$select public.create_board('代数练习')$$,
  '用户 A 可以通过 RPC 创建画板'
);
select is((select count(*) from public.boards), 1::bigint, '用户 A 可以读取自己的画板');
select throws_ok(
  $$update public.boards set title = '绕过 RPC'$$,
  '42501',
  'permission denied for table boards',
  '登录用户不能直接更新画板'
);

reset role;
create temporary table test_state (board_id uuid primary key);
insert into test_state select id from public.boards where owner_id = '11111111-1111-4111-8111-111111111111';
grant select on test_state to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((select count(*) from public.boards), 0::bigint, '用户 B 看不到用户 A 的画板');
select throws_ok(
  pg_catalog.format(
    'select public.rename_board(%L::uuid, %L)',
    (select board_id from test_state),
    '越权重命名'
  ),
  'P0001',
  'BOARD_NOT_FOUND',
  '用户 B 不能重命名用户 A 的画板'
);
select throws_ok(
  pg_catalog.format(
    'select public.save_board(%L::uuid, 0, %L::jsonb, %L::jsonb, %L)',
    (select board_id from test_state),
    '{}',
    '[]',
    'editor-b'
  ),
  'P0001',
  'BOARD_NOT_FOUND',
  '用户 B 不能保存用户 A 的画板'
);
select throws_ok(
  pg_catalog.format('select public.delete_board(%L::uuid)', (select board_id from test_state)),
  'P0001',
  'BOARD_NOT_FOUND',
  '用户 B 不能删除用户 A 的画板'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  pg_catalog.format(
    $sql$
      select public.save_board(
        %1$L::uuid,
        0,
        jsonb_build_object(
          'schemaVersion', 2,
          'boardId', %1$L,
          'revision', 0,
          'excalidraw', jsonb_build_object('elements', '[]'::jsonb, 'appState', '{}'::jsonb),
          'assets', jsonb_build_array(jsonb_build_object(
            'fileId', 'file-1',
            'objectPath', %2$L,
            'contentHash', %3$L,
            'mimeType', 'image/png',
            'byteSize', 1024,
            'width', 32,
            'height', 32
          )),
          'tutorBoards', '[]'::jsonb,
          'updatedAt', '2026-09-22T00:00:00.000Z'
        ),
        jsonb_build_array(jsonb_build_object(
          'fileId', 'file-1',
          'objectPath', %2$L,
          'contentHash', %3$L,
          'mimeType', 'image/png',
          'byteSize', 1024,
          'width', 32,
          'height', 32
        )),
        'editor-a'
      )
    $sql$,
    (select board_id from test_state),
    pg_catalog.concat(
      '11111111-1111-4111-8111-111111111111/',
      (select board_id from test_state),
      '/',
      pg_catalog.repeat('a', 64)
    ),
    pg_catalog.repeat('a', 64)
  ),
  '用户 A 可以原子保存快照和资产清单'
);
select is((select revision from public.boards), 1::bigint, '保存后 revision 原子递增');
select throws_ok(
  pg_catalog.format(
    'select public.save_board(%L::uuid, 0, %L::jsonb, %L::jsonb, %L)',
    (select board_id from test_state),
    '{}',
    '[]',
    'editor-a'
  ),
  'P0001',
  'REVISION_CONFLICT',
  '旧 revision 被拒绝'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is((select count(*) from public.board_assets), 0::bigint, '用户 B 看不到用户 A 的资产');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok(
  pg_catalog.format(
    'insert into storage.objects (bucket_id, name) values (%L, %L)',
    'board-assets',
    pg_catalog.concat(
      '11111111-1111-4111-8111-111111111111/',
      (select board_id from test_state),
      '/',
      pg_catalog.repeat('a', 64)
    )
  ),
  '用户 A 可以写入自己画板的私有对象路径'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok(
  pg_catalog.format(
    'insert into storage.objects (bucket_id, name) values (%L, %L)',
    'board-assets',
    pg_catalog.concat(
      '11111111-1111-4111-8111-111111111111/',
      (select board_id from test_state),
      '/',
      pg_catalog.repeat('b', 64)
    )
  ),
  '42501',
  'new row violates row-level security policy for table "objects"',
  '用户 B 不能写入用户 A 的对象路径'
);

reset role;
insert into public.account_deletion_requests (
  user_id, requested_at, execute_after, status
) values (
  '11111111-1111-4111-8111-111111111111',
  now(),
  now() + interval '7 days',
  'pending'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (select count(*) from public.account_deletion_requests),
  1::bigint,
  '用户 A 可以读取自己的 pending 删除请求'
);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*) from public.account_deletion_requests),
  0::bigint,
  '用户 B 看不到用户 A 的删除请求'
);
select throws_ok(
  $$update public.account_deletion_requests set status = 'cancelled'$$,
  '42501',
  'permission denied for table account_deletion_requests',
  '用户不能绕过服务端函数修改删除状态'
);
select throws_ok(
  $$select count(*) from public.ai_feedback$$,
  '42501',
  'permission denied for table ai_feedback',
  '用户不能读取 AI 反馈元数据'
);
select throws_ok(
  $$select count(*) from public.security_audit_events$$,
  '42501',
  'permission denied for table security_audit_events',
  '用户不能读取安全审计事件'
);
select throws_ok(
  $$select count(*) from public.asset_cleanup_jobs$$,
  '42501',
  'permission denied for table asset_cleanup_jobs',
  '用户不能读取清理任务'
);
select throws_ok(
  $$select public.purge_expired_operational_records()$$,
  '42501',
  'permission denied for function purge_expired_operational_records',
  '用户不能执行保留期清理函数'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  pg_catalog.format('select public.delete_board(%L::uuid)', (select board_id from test_state)),
  '用户 A 可以通过 RPC 硬删除自己的画板'
);

reset role;
select is(
  (select count(*) from public.boards where id = (select board_id from test_state)),
  0::bigint,
  '画板数据库记录已立即删除'
);
select is(
  (
    select count(*)
    from public.asset_cleanup_jobs
    where object_path = pg_catalog.concat(
      '11111111-1111-4111-8111-111111111111/',
      (select board_id from test_state),
      '/',
      pg_catalog.repeat('a', 64)
    )
      and reason = 'board_deleted'
      and status = 'pending'
  ),
  1::bigint,
  '删除画板会原子写入资产清理任务'
);

select * from finish();
rollback;
