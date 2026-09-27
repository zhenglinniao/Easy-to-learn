create function public.claim_asset_cleanup_jobs(
  p_limit integer,
  p_now timestamptz
)
returns table (
  id bigint,
  object_path text,
  reason text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_now is null then
    raise exception 'INVALID_CLEANUP_CLAIM';
  end if;

  return query
  with candidates as (
    select job.id
    from public.asset_cleanup_jobs as job
    where job.status = 'pending'
      and job.not_before <= p_now
    order by job.not_before, job.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.asset_cleanup_jobs as job
    set status = 'running'
    from candidates
    where job.id = candidates.id
    returning job.id, job.object_path, job.reason, job.attempts
  )
  select claimed.id, claimed.object_path, claimed.reason, claimed.attempts
  from claimed;
end;
$$;

revoke all on function public.claim_asset_cleanup_jobs(integer, timestamptz)
from public, anon, authenticated;
grant execute on function public.claim_asset_cleanup_jobs(integer, timestamptz) to service_role;
