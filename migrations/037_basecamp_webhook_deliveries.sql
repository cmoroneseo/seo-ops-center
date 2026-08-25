-- Migration 037: durable, service-only Basecamp webhook delivery receipts

create table if not exists public.basecamp_webhook_deliveries (
  event_id bigint primary key,
  request_id uuid not null unique,
  kind text not null,
  recording_id bigint not null,
  received_at timestamp with time zone
    default timezone('utc'::text, now()) not null,
  processed_at timestamp with time zone,
  result text
);

alter table public.basecamp_webhook_deliveries enable row level security;

revoke all on table public.basecamp_webhook_deliveries
  from public, anon, authenticated;
grant select, insert, update on table public.basecamp_webhook_deliveries
  to service_role;
