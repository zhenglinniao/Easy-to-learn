create function public.enqueue_account_asset_cleanup(
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
      not_before = pg_catalog.least(public.asset_cleanup_jobs.not_before, excluded.not_before),
      status = 'pending',
      attempts = 0,
      last_error_code = null,
      updated_at = pg_catalog.now();

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

revoke all on function public.enqueue_account_asset_cleanup(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.enqueue_account_asset_cleanup(uuid, timestamptz) to service_role;
