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
    select job.id, job.status = 'running' as lease_expired
    from public.asset_cleanup_jobs as job
    where (
        (job.status = 'pending' and job.not_before <= p_now)
        or (
          job.status = 'running'
          and job.updated_at <= p_now - interval '15 minutes'
        )
      )
      and job.attempts < 10
    order by job.not_before, job.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.asset_cleanup_jobs as job
    set status = case
          when candidates.lease_expired and job.attempts + 1 >= 10 then 'failed'
          else 'running'
        end,
        attempts = job.attempts + case when candidates.lease_expired then 1 else 0 end,
        last_error_code = case
          when candidates.lease_expired then 'WORKER_LEASE_EXPIRED'
          else job.last_error_code
        end,
        updated_at = p_now
    from candidates
    where job.id = candidates.id
    returning job.id, job.object_path, job.reason, job.attempts, job.status
  )
  select claimed.id, claimed.object_path, claimed.reason, claimed.attempts
  from claimed
  where claimed.status = 'running';
end;
$$;

revoke all on function public.claim_asset_cleanup_jobs(integer, timestamptz)
from public, anon, authenticated;
grant execute on function public.claim_asset_cleanup_jobs(integer, timestamptz) to service_role;
