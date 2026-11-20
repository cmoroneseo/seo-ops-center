-- Migration 134: Sheet import keys.
--
-- NOT APPLIED. Do not run this against the production Supabase project.
-- Carlos reviews and applies it separately. Tests run it on PGlite only.

alter table public.marketing_plan_items
    drop constraint if exists marketing_plan_items_source_check,
    add constraint marketing_plan_items_source_check
        check (source in ('template', 'onboarding', 'custom', 'basecamp', 'sheet')),
    add column if not exists import_key text;

alter table public.tasks add column if not exists import_key text;

alter table public.marketing_plan_items
    drop constraint if exists marketing_plan_items_import_key_check,
    add constraint marketing_plan_items_import_key_check
        check (import_key is null or (
            length(import_key) <= 200
            and import_key ~ '^sheet:[A-Za-z0-9_-]{25,100}:[A-Za-z0-9 _-]{1,40}:[0-9]{1,6}$'
        ));

alter table public.tasks
    drop constraint if exists tasks_import_key_check,
    add constraint tasks_import_key_check
        check (import_key is null or (
            length(import_key) <= 200
            and import_key ~ '^sheet:[A-Za-z0-9_-]{25,100}:[A-Za-z0-9 _-]{1,40}:[0-9]{1,6}$'
        ));

drop index if exists public.marketing_plan_items_import_key_unique;
create unique index if not exists marketing_plan_items_import_key_unique
    on public.marketing_plan_items (client_id, import_key);

drop index if exists public.tasks_import_key_unique;
create unique index if not exists tasks_import_key_unique
    on public.tasks (client_id, import_key);
