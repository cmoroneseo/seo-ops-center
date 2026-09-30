-- Supabase default privileges grant anon directly, independently of PUBLIC.
revoke execute on function public.create_task_from_marketing_plan_item(uuid) from anon;
revoke execute on function public.add_existing_task_to_marketing_plan(uuid, uuid, text) from anon;
