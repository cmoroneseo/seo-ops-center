-- Supabase default privileges can grant new functions directly to anon,
-- independently of PUBLIC. Remove both grants on the setup entry points.
revoke all on function public.create_client_with_setup(uuid, uuid, text, text, uuid, date, date, numeric, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_client_with_setup(uuid, uuid, text, text, uuid, date, date, numeric, jsonb, jsonb, jsonb) to authenticated;
revoke all on function public.activate_client_setup_scope() from public, anon;
grant execute on function public.activate_client_setup_scope() to authenticated, service_role;
