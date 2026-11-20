-- PREPARED, NOT RUN. Needs Carlos's explicit yes and migration 133 applied first.

begin;

with sheet_links (client_id, sheet_id) as (
  values
    ('e6a2c36e-edeb-4cef-adef-0f6c3bcba62f'::uuid, '1yTnAqLSGcr1nU3iDE6qktyY6XZ9IGrBfKb4k5-6buww'), -- Swing Inn Cafe
    ('11981896-665f-4582-b5e9-cf63542f8a6c'::uuid, '1XrOhHolCVArZT5am_uCWhOPtjemw6PtqehViA7CbIbE'), -- Cuidando De Ti Advantage
    ('7071eda4-ccc6-4122-abef-4cb0702bc682'::uuid, '1AHtg2DJYDRD1AojOnTtAofrsakJzX7WNZtmi6lw1mu8') -- Floor Co Design USA
)
select c.id, c.name, s.sheet_id,
       'https://docs.google.com/spreadsheets/d/' || s.sheet_id || '/edit' as proposed_url
from public.clients as c
join sheet_links as s on s.client_id = c.id
where c.roadmap_sheet_url is null and c.roadmap_sheet_id is null
order by c.name;

with sheet_links (client_id, sheet_id) as (
  values
    ('e6a2c36e-edeb-4cef-adef-0f6c3bcba62f'::uuid, '1yTnAqLSGcr1nU3iDE6qktyY6XZ9IGrBfKb4k5-6buww'),
    ('11981896-665f-4582-b5e9-cf63542f8a6c'::uuid, '1XrOhHolCVArZT5am_uCWhOPtjemw6PtqehViA7CbIbE'),
    ('7071eda4-ccc6-4122-abef-4cb0702bc682'::uuid, '1AHtg2DJYDRD1AojOnTtAofrsakJzX7WNZtmi6lw1mu8')
)
update public.clients as c
set roadmap_sheet_id = s.sheet_id,
    roadmap_sheet_url = 'https://docs.google.com/spreadsheets/d/' || s.sheet_id || '/edit'
from sheet_links as s
where c.id = s.client_id
  and c.roadmap_sheet_url is null
  and c.roadmap_sheet_id is null
returning c.id, c.name, c.roadmap_sheet_url;

commit;
