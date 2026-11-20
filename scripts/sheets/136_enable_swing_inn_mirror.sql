-- NOT RUN. Needs Carlos's explicit yes and migration 136 applied first.

begin;

select id, name, roadmap_sheet_id, sheet_mirror_enabled
from public.clients
where id = 'e6a2c36e-edeb-4cef-adef-0f6c3bcba62f';

update public.clients
set sheet_mirror_enabled = true
where id = 'e6a2c36e-edeb-4cef-adef-0f6c3bcba62f'
  and roadmap_sheet_id is not null
returning id, name, sheet_mirror_enabled;

-- Expect exactly one enabled client, Swing Inn.
select id, name, roadmap_sheet_id, sheet_mirror_enabled
from public.clients
where sheet_mirror_enabled = true;

commit;
