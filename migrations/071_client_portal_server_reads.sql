-- Portal management uses authorized server routes and the service role.
-- Do not advertise portal metadata in the signed-in GraphQL schema.
-- RLS policies stay in place as defense in depth.
revoke select on table public.client_portal_updates,
    public.client_portal_settings,
    public.client_portal_delivery_updates,
    public.client_portal_conversations,
    public.client_portal_visits from authenticated;
