-- Easy to learn 初始数据层：用户画板、私有资产、账户删除、反馈和清理队列。
-- 所有 SECURITY DEFINER 函数固定空 search_path，并对对象使用完全限定名。

create extension if not exists pgcrypto with schema extensions;

create table public.boards (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '未命名画板' check (char_length(title) between 1 and 120),
  snapshot_json jsonb not null,
  schema_version integer not null default 2 check (schema_version = 2),
  revision bigint not null default 0 check (revision >= 0),
  last_editor_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index boards_owner_updated_idx on public.boards (owner_id, updated_at desc);

create table public.board_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  file_id text not null check (char_length(file_id) between 1 and 100),
  object_path text not null unique,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  created_at timestamptz not null default now(),
  constraint board_assets_pixel_limit check ((width::bigint * height::bigint) <= 32000000),
  constraint board_assets_board_file_unique unique (board_id, file_id),
  constraint board_assets_board_hash_unique unique (board_id, content_hash)
);

create index board_assets_board_idx on public.board_assets (board_id);

create table public.account_deletion_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null,
  execute_after timestamptz not null,
  status text not null check (status in ('pending', 'cancelled', 'executing', 'completed', 'failed')),
  updated_at timestamptz not null default now(),
  constraint account_deletion_cooling_period check (execute_after = requested_at + interval '7 days')
);

create table public.ai_feedback (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null unique,
  actor_hash text not null,
  rating smallint not null check (rating in (-1, 1)),
  category text,
  model text not null,
  prompt_version text not null,
  schema_version integer not null check (schema_version > 0),
  created_at timestamptz not null default now()
);

create index ai_feedback_created_idx on public.ai_feedback (created_at);

create table public.security_audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_hash text not null,
  event_type text not null,
  outcome text not null check (outcome in ('success', 'failure')),
  target_hash text,
  request_id uuid,
  error_code text,
  created_at timestamptz not null default now()
);

create index security_audit_events_created_idx on public.security_audit_events (created_at);

create table public.asset_cleanup_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  object_path text not null unique,
  reason text not null check (
    reason in ('board_deleted', 'orphaned_upload', 'account_deleted', 'temp_expired')
  ),
  not_before timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 10),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index asset_cleanup_jobs_ready_idx
  on public.asset_cleanup_jobs (not_before, created_at)
  where status = 'pending';

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger boards_set_updated_at
before update on public.boards
for each row execute function public.set_updated_at();

create trigger account_deletion_requests_set_updated_at
before update on public.account_deletion_requests
for each row execute function public.set_updated_at();

create trigger asset_cleanup_jobs_set_updated_at
before update on public.asset_cleanup_jobs
for each row execute function public.set_updated_at();

alter table public.boards enable row level security;
alter table public.boards force row level security;
alter table public.board_assets enable row level security;
alter table public.board_assets force row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_requests force row level security;
alter table public.ai_feedback enable row level security;
alter table public.ai_feedback force row level security;
alter table public.security_audit_events enable row level security;
alter table public.security_audit_events force row level security;
alter table public.asset_cleanup_jobs enable row level security;
alter table public.asset_cleanup_jobs force row level security;

create policy boards_select_own on public.boards
for select to authenticated
using ((select auth.uid()) = owner_id);

create policy boards_insert_own on public.boards
for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy boards_update_own on public.boards
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy boards_delete_own on public.boards
for delete to authenticated
using ((select auth.uid()) = owner_id);

create policy board_assets_select_own on public.board_assets
for select to authenticated
using (
  exists (
    select 1
    from public.boards as board
    where board.id = board_assets.board_id
      and board.owner_id = (select auth.uid())
  )
);

create policy account_deletion_requests_select_pending_own on public.account_deletion_requests
for select to authenticated
using ((select auth.uid()) = user_id and status = 'pending');

revoke all on table public.boards from anon, authenticated;
revoke all on table public.board_assets from anon, authenticated;
revoke all on table public.account_deletion_requests from anon, authenticated;
revoke all on table public.ai_feedback from anon, authenticated;
revoke all on table public.security_audit_events from anon, authenticated;
revoke all on table public.asset_cleanup_jobs from anon, authenticated;

grant select on table public.boards to authenticated;
grant select on table public.board_assets to authenticated;
grant select on table public.account_deletion_requests to authenticated;

grant all on table public.boards to service_role;
grant all on table public.board_assets to service_role;
grant all on table public.account_deletion_requests to service_role;
grant all on table public.ai_feedback to service_role;
grant all on table public.security_audit_events to service_role;
grant all on table public.asset_cleanup_jobs to service_role;

create function public.create_board(p_title text default '未命名画板')
returns table (
  board_id uuid,
  revision bigint,
  snapshot jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_board_id uuid := extensions.gen_random_uuid();
  v_title text := pg_catalog.btrim(pg_catalog.coalesce(p_title, ''));
  v_now timestamptz := pg_catalog.now();
  v_snapshot jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if pg_catalog.char_length(v_title) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  if (select pg_catalog.count(*) from public.boards where owner_id = v_user_id) >= 100 then
    raise exception using errcode = 'P0001', message = 'STORAGE_QUOTA_EXCEEDED';
  end if;

  v_snapshot := pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'boardId', v_board_id::text,
    'revision', 0,
    'excalidraw', pg_catalog.jsonb_build_object(
      'elements', '[]'::jsonb,
      'appState', pg_catalog.jsonb_build_object(
        'viewBackgroundColor', '#ffffff',
        'gridSize', null,
        'gridStep', 20,
        'gridModeEnabled', false,
        'objectsSnapModeEnabled', false
      )
    ),
    'assets', '[]'::jsonb,
    'tutorBoards', '[]'::jsonb,
    'updatedAt', pg_catalog.to_jsonb(v_now)
  );

  insert into public.boards (
    id, owner_id, title, snapshot_json, schema_version, revision, last_editor_id, created_at, updated_at
  ) values (
    v_board_id, v_user_id, v_title, v_snapshot, 2, 0, 'server:create', v_now, v_now
  );

  return query
  select v_board_id, 0::bigint, v_snapshot, v_now, v_now;
end;
$$;

create function public.rename_board(p_board_id uuid, p_title text)
returns table (board_id uuid, title text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := pg_catalog.btrim(pg_catalog.coalesce(p_title, ''));
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if pg_catalog.char_length(v_title) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  return query
  update public.boards as board
  set title = v_title
  where board.id = p_board_id and board.owner_id = v_user_id
  returning board.id, board.title, board.updated_at;

  if not found then
    raise exception using errcode = 'P0001', message = 'BOARD_NOT_FOUND';
  end if;
end;
$$;

create function public.save_board(
  p_board_id uuid,
  p_expected_revision bigint,
  p_snapshot jsonb,
  p_asset_manifest jsonb,
  p_editor_id text
)
returns table (board_id uuid, revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_revision bigint;
  v_new_revision bigint;
  v_now timestamptz := pg_catalog.now();
  v_snapshot jsonb;
  v_user_asset_bytes bigint;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_expected_revision < 0 or pg_catalog.char_length(pg_catalog.coalesce(p_editor_id, '')) = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select board.revision
  into v_current_revision
  from public.boards as board
  where board.id = p_board_id and board.owner_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BOARD_NOT_FOUND';
  end if;
  if v_current_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'REVISION_CONFLICT';
  end if;
  if pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
    or pg_catalog.jsonb_typeof(p_asset_manifest) <> 'array'
    or p_snapshot ->> 'schemaVersion' <> '2'
    or p_snapshot ->> 'boardId' <> p_board_id::text
    or pg_catalog.jsonb_typeof(p_snapshot -> 'excalidraw') <> 'object'
    or pg_catalog.jsonb_typeof(p_snapshot #> '{excalidraw,elements}') <> 'array'
    or pg_catalog.jsonb_typeof(p_snapshot #> '{excalidraw,appState}') <> 'object'
    or pg_catalog.jsonb_typeof(p_snapshot -> 'tutorBoards') <> 'array'
    or p_snapshot -> 'assets' is distinct from p_asset_manifest
  then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_snapshot #> '{excalidraw,elements}') as element(value)
    where pg_catalog.jsonb_typeof(element.value) <> 'object'
      or element.value ->> 'type' not in (
        'rectangle', 'diamond', 'ellipse', 'text', 'image', 'line', 'arrow', 'freedraw',
        'frame', 'magicframe', 'iframe', 'embeddable'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_asset_manifest) as item(value)
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
      or not (item.value ?& array[
        'fileId', 'objectPath', 'contentHash', 'mimeType', 'byteSize', 'width', 'height'
      ])
      or item.value ->> 'fileId' = ''
      or pg_catalog.char_length(item.value ->> 'fileId') > 100
      or item.value ->> 'contentHash' !~ '^[a-f0-9]{64}$'
      or item.value ->> 'mimeType' not in ('image/png', 'image/jpeg', 'image/webp')
      or item.value ->> 'byteSize' !~ '^[0-9]+$'
      or item.value ->> 'width' !~ '^[0-9]+$'
      or item.value ->> 'height' !~ '^[0-9]+$'
      or (item.value ->> 'byteSize')::bigint not between 1 and 10485760
      or (item.value ->> 'width')::integer not between 1 and 8192
      or (item.value ->> 'height')::integer not between 1 and 8192
      or (
        (item.value ->> 'width')::bigint * (item.value ->> 'height')::bigint
      ) > 32000000
      or item.value ->> 'objectPath' <> pg_catalog.concat(
        v_user_id::text, '/', p_board_id::text, '/', item.value ->> 'contentHash'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_asset_manifest)
      as asset("fileId" text, "contentHash" text)
    group by asset."fileId"
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_asset_manifest)
      as asset("fileId" text, "contentHash" text)
    group by asset."contentHash"
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  if pg_catalog.coalesce((
    select pg_catalog.sum((item.value ->> 'byteSize')::bigint)
    from pg_catalog.jsonb_array_elements(p_asset_manifest) as item(value)
  ), 0) > 104857600 then
    raise exception using errcode = 'P0001', message = 'STORAGE_QUOTA_EXCEEDED';
  end if;

  select pg_catalog.coalesce(pg_catalog.sum(asset.byte_size), 0)
  into v_user_asset_bytes
  from public.board_assets as asset
  join public.boards as board on board.id = asset.board_id
  where board.owner_id = v_user_id and board.id <> p_board_id;

  v_user_asset_bytes := v_user_asset_bytes + pg_catalog.coalesce((
    select pg_catalog.sum((item.value ->> 'byteSize')::bigint)
    from pg_catalog.jsonb_array_elements(p_asset_manifest) as item(value)
  ), 0);
  if v_user_asset_bytes > 1073741824 then
    raise exception using errcode = 'P0001', message = 'STORAGE_QUOTA_EXCEEDED';
  end if;

  v_new_revision := v_current_revision + 1;
  v_snapshot := pg_catalog.jsonb_set(p_snapshot, '{revision}', pg_catalog.to_jsonb(v_new_revision), false);
  v_snapshot := pg_catalog.jsonb_set(v_snapshot, '{updatedAt}', pg_catalog.to_jsonb(v_now), false);
  if pg_catalog.octet_length(v_snapshot::text) > 10485760 then
    raise exception using errcode = 'P0001', message = 'BOARD_TOO_LARGE';
  end if;

  insert into public.asset_cleanup_jobs (object_path, reason, not_before)
  select asset.object_path, 'orphaned_upload', v_now + interval '24 hours'
  from public.board_assets as asset
  where asset.board_id = p_board_id
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_asset_manifest) as manifest_item(value)
      where manifest_item.value ->> 'objectPath' = asset.object_path
    )
  on conflict (object_path) do update
  set reason = excluded.reason,
      not_before = pg_catalog.least(public.asset_cleanup_jobs.not_before, excluded.not_before),
      attempts = 0,
      status = 'pending',
      last_error_code = null,
      updated_at = v_now;

  delete from public.board_assets where board_id = p_board_id;
  insert into public.board_assets (
    board_id, file_id, object_path, content_hash, mime_type, byte_size, width, height
  )
  select
    p_board_id,
    asset."fileId",
    asset."objectPath",
    asset."contentHash",
    asset."mimeType",
    asset."byteSize",
    asset.width,
    asset.height
  from pg_catalog.jsonb_to_recordset(p_asset_manifest) as asset(
    "fileId" text,
    "objectPath" text,
    "contentHash" text,
    "mimeType" text,
    "byteSize" bigint,
    width integer,
    height integer
  );

  update public.boards as board
  set snapshot_json = v_snapshot,
      revision = v_new_revision,
      last_editor_id = p_editor_id,
      updated_at = v_now
  where board.id = p_board_id;

  return query select p_board_id, v_new_revision, v_now;
end;
$$;

create function public.delete_board(p_board_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  perform 1
  from public.boards as board
  where board.id = p_board_id and board.owner_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'BOARD_NOT_FOUND';
  end if;

  insert into public.asset_cleanup_jobs (object_path, reason, not_before)
  select asset.object_path, 'board_deleted', pg_catalog.now()
  from public.board_assets as asset
  where asset.board_id = p_board_id
  on conflict (object_path) do update
  set reason = excluded.reason,
      not_before = pg_catalog.least(public.asset_cleanup_jobs.not_before, excluded.not_before),
      attempts = 0,
      status = 'pending',
      last_error_code = null,
      updated_at = pg_catalog.now();

  delete from public.boards where id = p_board_id;
  return true;
end;
$$;

create function public.purge_expired_operational_records()
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

  return next;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.create_board(text) from public, anon;
revoke all on function public.rename_board(uuid, text) from public, anon;
revoke all on function public.save_board(uuid, bigint, jsonb, jsonb, text) from public, anon;
revoke all on function public.delete_board(uuid) from public, anon;
revoke all on function public.purge_expired_operational_records() from public, anon, authenticated;

grant execute on function public.create_board(text) to authenticated;
grant execute on function public.rename_board(uuid, text) to authenticated;
grant execute on function public.save_board(uuid, bigint, jsonb, jsonb, text) to authenticated;
grant execute on function public.delete_board(uuid) to authenticated;
grant execute on function public.purge_expired_operational_records() to service_role;

-- 私有 bucket 与对象策略。ai-temp 仅允许 service role/签名上传流程访问。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('board-assets', 'board-assets', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('ai-temp', 'ai-temp', false, 10485760, array['image/png', 'image/jpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy board_assets_storage_select_own on storage.objects
for select to authenticated
using (
  bucket_id = 'board-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.boards as board
    where board.owner_id = (select auth.uid())
      and board.id::text = (storage.foldername(name))[2]
  )
);

create policy board_assets_storage_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'board-assets'
  and pg_catalog.array_length(storage.foldername(name), 1) = 3
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[3] ~ '^[a-f0-9]{64}$'
  and exists (
    select 1
    from public.boards as board
    where board.owner_id = (select auth.uid())
      and board.id::text = (storage.foldername(name))[2]
  )
);

create policy board_assets_storage_update_own on storage.objects
for update to authenticated
using (
  bucket_id = 'board-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.boards as board
    where board.owner_id = (select auth.uid())
      and board.id::text = (storage.foldername(name))[2]
  )
)
with check (
  bucket_id = 'board-assets'
  and pg_catalog.array_length(storage.foldername(name), 1) = 3
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[3] ~ '^[a-f0-9]{64}$'
  and exists (
    select 1
    from public.boards as board
    where board.owner_id = (select auth.uid())
      and board.id::text = (storage.foldername(name))[2]
  )
);

create policy board_assets_storage_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'board-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.boards as board
    where board.owner_id = (select auth.uid())
      and board.id::text = (storage.foldername(name))[2]
  )
);
