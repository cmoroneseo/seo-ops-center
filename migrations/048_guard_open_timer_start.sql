-- Migration 048: protect live timers from invalid client-supplied timestamps.
--
-- The Planner supports backdating a live timer within the current local day.
-- The API performs that timezone-aware check. This trigger is the final data
-- boundary for direct RPC calls: an open segment can never begin in the future
-- or more than 24 hours ago.

create or replace function public.guard_open_timer_segment_start()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.ended_at is null and new.started_at > clock_timestamp() then
    raise exception 'open timer cannot start in the future' using errcode = '22023';
  end if;

  if new.ended_at is null
     and new.started_at < clock_timestamp() - interval '24 hours' then
    raise exception 'open timer cannot start more than 24 hours ago' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_open_timer_segment_start()
  from public, anon, authenticated;

drop trigger if exists guard_open_timer_segment_start on public.time_log_segments;
create trigger guard_open_timer_segment_start
  before insert or update of started_at, ended_at on public.time_log_segments
  for each row execute function public.guard_open_timer_segment_start();
