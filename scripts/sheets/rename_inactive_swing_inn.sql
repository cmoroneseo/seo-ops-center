-- PREPARED, NOT RUN. Requires Carlos's explicit yes before execution.

begin;

select id, name, status from public.clients
where id = 'e052bbcf-9200-4a85-8e97-b49e624a963a';

update public.clients
set name = 'Swing Inn Cafe (2025, old)'
where id = 'e052bbcf-9200-4a85-8e97-b49e624a963a'
  and status = 'inactive'
  and name = 'Swing Inn Cafe'
returning id, name, status;

commit;
