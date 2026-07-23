# Personal Reminders — Design Spec

**Date:** 2026-07-22
**Status:** Approved for planning
**Owner:** Carlos Morones

## Summary

A personal reminders tool for SEO Ops Center, following the Notepad "Personal Tools" pattern: opened from UserMenu → Personal Tools → Reminders, rendered as a fixed panel under the TopNav. ClickUp-style quick capture with natural-language date parsing, optional client linking, simple recurrence, and delivery through the existing bell-notification system via a Vercel cron.

## Decisions made

- **Delivery:** bell notification only (reuses NotificationBell + realtime). No email, no browser push in v1.
- **Linking:** optional `client_id` FK. No task linking in v1.
- **Recurrence:** simple presets only — `none | daily | weekly | monthly`.
- **Capture:** natural-language date parsing via `chrono-node` + preset chips + mini calendar fallback.
- **Personal only:** reminders cannot be assigned to other members.

## Database — migration `025_personal_reminders.sql`

Table `personal_reminders` (mirror into `schema.sql`):

| column | type | notes |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `organization_id` | uuid NOT NULL FK → organizations | RLS org check |
| `user_id` | uuid NOT NULL | `auth.uid()` owner |
| `title` | text NOT NULL | |
| `notes` | text | nullable |
| `due_at` | timestamptz NOT NULL | when the reminder is due |
| `notify_offset_minutes` | int | 0 = on due date; 10, 60, custom; NULL = don't notify |
| `recurrence` | text NOT NULL default 'none' | CHECK `none \| daily \| weekly \| monthly` |
| `client_id` | uuid | nullable FK → clients, ON DELETE SET NULL |
| `status` | text NOT NULL default 'pending' | CHECK `pending \| done \| dismissed` |
| `notified_at` | timestamptz | stamped by cron when notification fires |
| `completed_at` | timestamptz | stamped on completion |
| `created_at` / `updated_at` | timestamptz default now() | |

- Index: `(status, due_at)` for the cron sweep; `(user_id, status)` for panel queries.
- **RLS:** strictly personal — `user_id = auth.uid() AND organization_id IN (SELECT get_user_org_ids())` for all operations (same pattern as `personal_notes`).

## TypeScript layer

- `Reminder` interface + `ReminderRecurrence`, `ReminderStatus` unions in `lib/types.ts`.
- `lib/supabase/personal-reminders.ts`: `rowToReminder` / `reminderToRow` mappers, CRUD (`listReminders`, `createReminder`, `updateReminder`, `completeReminder`, `snoozeReminder`, `deleteReminder`).
- `completeReminder` handles recurrence: if `recurrence !== 'none'`, instead of marking done it advances `due_at` (+1 day / +7 days / +1 month), clears `notified_at`, keeps `status = 'pending'`. A recurring reminder is retired via delete or by setting recurrence to none, then completing.

## Firing — cron `/api/cron/fire-reminders`

- Schedule: every 5 minutes (`vercel.json`).
- Query: `status = 'pending' AND notified_at IS NULL AND notify_offset_minutes IS NOT NULL AND due_at - notify_offset <= now()`.
- For each match: insert a row into `notifications` with new type `reminder_due` (add to notification types in `lib/supabase/notifications.ts`), targeted at the reminder's `user_id`. Link URL: `/workspace/[client_id]` when client-linked, otherwise opens the reminders panel (see Bell integration).
- Stamp `notified_at` after insert (idempotent — a reminder never fires twice).
- Uses service-role client like the existing deliverables cron; protected by `CRON_SECRET` header check, same as other crons.

## Panel UI — `components/reminders/RemindersPanel.tsx`

Mounted in `app/(dashboard)/layout.tsx`, desktop-only, fixed `top-16 right-4`, ~420px wide (same footprint/behavior as NotepadPanel). Opens on `reminders:open` window event fired from UserMenu → Personal Tools → Reminders (new item with Bell/Alarm icon).

### Capture bar (top, autofocused on open)

- Single text input: placeholder "Remind me to…". Enter creates.
- **Date chip** next to input, default "Today". Clicking opens a popover:
  - Free-text input at top: "Try 'Tomorrow at 2 PM'…" — parsed live with `chrono-node`, resolved date shown as preview; Enter accepts.
  - Preset rows with resolved times right-aligned: In 20 minutes / In 2 hours / Tomorrow 8:00 AM / In 2 days / Next week Mon 8:00 AM.
  - Recurrence row: None / Daily / Weekly / Monthly.
  - Mini month calendar below (custom lightweight grid, no new dependency) + time input.
- **Client chip** (optional): searchable client picker reusing the existing client list data.
- **Notify chip**: On due date (default) / 10 minutes before / 1 hour before / Custom minutes / Don't notify.

### List (below capture)

Grouped sections: **Overdue** (red accent) / **Today** / **Upcoming** / **Done** (collapsed by default, shows recent 20).

Each row:
- Checkbox → complete (or advance, if recurring).
- Title; notes preview line if present.
- Relative due label ("in 2 hrs", "Tue 8:00 AM", "3 days overdue").
- Client chip if linked — click navigates to `/workspace/[id]`.
- Recurrence icon if recurring.
- Hover actions: snooze (+1 hour / Tomorrow 8 AM), delete (with confirm). Title renames inline (click to edit, Enter/blur saves, Escape cancels) — same pattern as deliverable titles. Date changes happen via snooze; full inline edit is deferred.

### Badge

Overdue count shows as a small dot/count on the UserMenu avatar (reuse the existing dropdown pattern; no new TopNav icon).

## Bell integration

- New notification type `reminder_due` renders in NotificationBell with an alarm icon.
- Click behavior: if the reminder is client-linked → navigate to the client workspace; otherwise fire `reminders:open`.
- Snooze/complete live in the panel only — the notifications system is not modified beyond the new type.

## Dependencies

- `chrono-node` (NL date parsing) — the only new dependency.

## Out of scope (v1)

- Assigning reminders to others; email or browser push delivery; attachments; task linking; note→reminder conversion; full RRULE recurrence (every-N, specific weekdays, end dates).

## Build order

1. Migration `025_personal_reminders.sql` + `schema.sql` mirror
2. `lib/types.ts` + `lib/supabase/personal-reminders.ts`
3. Cron route + `vercel.json` entry + notification type
4. `RemindersPanel` (capture bar, date popover, list)
5. UserMenu wiring + layout mount + bell click behavior
