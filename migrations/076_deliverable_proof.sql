-- 076: require a live URL and a ship date when a deliverable becomes Published.
-- 075 is reserved and unused. This file does not take it.
--
-- Storage: no new table, column, or index. The trigger does not rewrite
-- deliverables. Existing Published rows stay editable, including the rows
-- that were published before a URL was required.
--
-- The check runs only on the transition into Published (INSERT of Published,
-- or UPDATE whose old status is not Published). A later edit of a Published
-- row does not re-check, so historical rows can gain a URL.
--
-- Apply this file in the Supabase SQL editor before the app that enforces
-- the same rule is deployed.
--
-- Rollback:
-- drop trigger if exists enforce_deliverable_published_proof on public.deliverables;
-- drop function if exists public.enforce_deliverable_published_proof();

create or replace function public.enforce_deliverable_published_proof()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_url text;
  v_host text;
  v_domain text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from 'Published' then
    return new;
  end if;
  if new.status is distinct from 'Published' then
    return new;
  end if;

  v_url := nullif(btrim(coalesce(new.published_url, '')), '');
  if v_url is null then
    raise exception 'Add the live page URL before marking this Published.'
      using errcode = '23514';
  end if;
  if new.delivered_on is null then
    raise exception 'Add the ship date before marking this Published.'
      using errcode = '23514';
  end if;

  if v_url !~* '^https?://' then
    raise exception 'The live URL has to start with http:// or https://.'
      using errcode = '23514';
  end if;

  v_host := lower(substring(v_url from '://([^/?#]+)'));
  if v_host is null or position('@' in v_host) > 0 then
    v_host := split_part(coalesce(v_host, ''), '@', 2);
  end if;
  v_host := split_part(coalesce(v_host, ''), ':', 1);
  v_host := regexp_replace(v_host, '^www\.', '');
  if v_host is null or v_host !~ '^[a-z0-9.-]+$' then
    raise exception 'The live URL has to start with http:// or https://.'
      using errcode = '23514';
  end if;

  select lower(btrim(coalesce(domain, ''))) into v_domain
  from public.clients
  where id = new.client_id;

  v_domain := coalesce(v_domain, '');
  if v_domain ~ '^[a-z][a-z0-9+.-]*://' then
    v_domain := lower(substring(v_domain from '://([^/?#]+)'));
  end if;
  v_domain := split_part(coalesce(v_domain, ''), '/', 1);
  v_domain := split_part(v_domain, '?', 1);
  v_domain := split_part(v_domain, ':', 1);
  v_domain := regexp_replace(v_domain, '^www\.', '');

  if v_domain <> '' and (v_host = v_domain or right(v_host, char_length(v_domain) + 1) = '.' || v_domain) then
    return new;
  end if;

  if exists (
    select 1
    from unnest(array[
      'google.com',
      'g.page',
      'business.google',
      'maps.app.goo.gl',
      'yelp.com',
      'facebook.com',
      'bbb.org',
      'yellowpages.com',
      'angi.com',
      'angieslist.com',
      'thumbtack.com',
      'nextdoor.com',
      'bing.com',
      'mapquest.com',
      'apple.com',
      'foursquare.com',
      'tripadvisor.com',
      'houzz.com',
      'homeadvisor.com',
      'manta.com',
      'superpages.com',
      'merchantcircle.com',
      'alignable.com',
      'linkedin.com'
    ]::text[]) as allowed(host)
    where v_host = allowed.host
       or right(v_host, char_length(allowed.host) + 1) = '.' || allowed.host
  ) then
    return new;
  end if;

  raise exception 'The live URL has to be on the client domain, or on a known Business Profile or citation site.'
    using errcode = '23514';
end $$;

drop trigger if exists enforce_deliverable_published_proof on public.deliverables;
create trigger enforce_deliverable_published_proof
  before insert or update on public.deliverables
  for each row
  execute function public.enforce_deliverable_published_proof();
