import { readFile } from 'node:fs/promises';
import process from 'node:process';

const migrationPath = 'supabase/migrations/202609220001_initial_schema.sql';
const testPath = 'supabase/tests/database/001_rls_and_rpc.test.sql';

const [migration, tests] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(testPath, 'utf8'),
]);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`数据库契约静态检查失败：${message}`);
  }
};

const tables = [
  'boards',
  'board_assets',
  'account_deletion_requests',
  'ai_feedback',
  'security_audit_events',
  'asset_cleanup_jobs',
];

for (const table of tables) {
  assert(migration.includes(`create table public.${table}`), `缺少 ${table} 表`);
  assert(
    migration.includes(`alter table public.${table} enable row level security`),
    `${table} 未启用 RLS`,
  );
  assert(
    migration.includes(`alter table public.${table} force row level security`),
    `${table} 未强制 RLS`,
  );
}

const rpcSignatures = [
  'public.create_board(text)',
  'public.rename_board(uuid, text)',
  'public.save_board(uuid, bigint, jsonb, jsonb, text)',
  'public.delete_board(uuid)',
];

for (const signature of rpcSignatures) {
  assert(
    migration.includes(`revoke all on function ${signature} from public, anon`),
    `${signature} 未撤销公开执行权`,
  );
  assert(
    migration.includes(`grant execute on function ${signature} to authenticated`),
    `${signature} 未显式授权 authenticated`,
  );
}

assert(
  migration.includes(
    'revoke all on function public.upsert_ai_feedback(uuid, text, smallint, text, text, text, integer)',
  ) &&
    migration.includes(
      'grant execute on function public.upsert_ai_feedback(uuid, text, smallint, text, text, text, integer)',
    ),
  'AI 反馈写入函数必须仅授权 service_role',
);

const functionStatements = migration.match(/create function[\s\S]*?\$\$;/g) ?? [];
for (const statement of functionStatements) {
  if (statement.includes('security definer')) {
    assert(statement.includes("set search_path = ''"), 'SECURITY DEFINER 函数未固定空 search_path');
  }
}

assert(
  migration.includes("('board-assets', 'board-assets', false") &&
    migration.includes("('ai-temp', 'ai-temp', false"),
  'Storage bucket 必须保持私有',
);
assert(
  migration.includes("created_at < pg_catalog.now() - interval '90 days'") &&
    migration.includes("created_at < pg_catalog.now() - interval '180 days'") &&
    migration.includes("updated_at < pg_catalog.now() - interval '30 days'"),
  '运行数据保留期与已确认方案不一致',
);
assert(
  migration.includes("'orphaned_upload', v_now + interval '24 hours'"),
  '取消引用的画板资产没有进入 24 小时延迟清理队列',
);

const planned = Number(tests.match(/select plan\((\d+)\)/)?.[1]);
const assertions = (tests.match(/^select (?:has_|ok\(|lives_ok\(|is\(|throws_ok\()/gm) ?? [])
  .length;
assert(Number.isInteger(planned) && planned === assertions, 'pgTAP plan 与断言数量不一致');

process.stdout.write(
  `数据库契约静态检查通过：${tables.length} 张表，${assertions} 项 pgTAP 断言。\n`,
);
