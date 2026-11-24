# Bot API

SEO bots look up clients, create and complete tasks, and run timers in SEO Ops Center over HTTP. Time is attributed to Carlos Morones (`cmorones@marketingempiregroup.com`, user `360c97ac-54fc-41fb-b660-0566d63c2e1b`). A stopped timer is a normal SEO Ops time entry: a closed session on `time_logs`, then the same Basecamp timesheet path the task drawer uses.

Bots start and stop timers to record elapsed time. SEO bots can reduce that time with `hours` on stop. `POST /api/bots/time` is gone.

Tasks created from bot input are assigned to Carlos. The insert sets `assignee_id` and `assignee_ids` to his user id, `created_by` to the same id, and `status_history` to a `todo` entry by him. `priority` is `medium` and `tags` is empty. A top-level to-do imported from Basecamp is also assigned to Carlos and carries the provider's completion state. Imported steps carry their Basecamp completion state and arrive unassigned.

This is not a Supabase key. A bot key cannot read the database, delete rows, or change settings. The service role stays on the server.

**Migration `114_bot_running_timer` is marked NOT APPLIED** in `migrations/114_bot_running_timer.sql`. It adds one unique index so a bot cannot have two running timers (`status = 'in_progress'`). The index closes a race between two starts. A paused row is not `in_progress`, so it does not take that slot. Migration 113 (bot keys, `bot_key_id`) is already in production. Apply 114 before relying on the index in production.

**Migration `127_bot_timer_pause` is NOT APPLIED.** It widens `time_logs.status` to allow `paused`, and adds `time_log_segments.note` for the notes on each stretch. Do not run it until it is approved on its own. Pause and resume need it. Human pause does not use `paused` and does not write `note`.

## Auth

Send this header on every bot route:

```
Authorization: Bearer <minted-bot-token>
```

`<minted-bot-token>` is the `token` field from the mint response. It is shown once and is not stored in this repository. Tokens use the prefix `seo_bot_`.

Keys are minted by an organization owner (dashboard session, not a bot key):

```bash
curl -X POST https://seo-ops-center.vercel.app/api/bots/keys \
  -H 'Content-Type: application/json' \
  -H "Cookie: <owner session>" \
  -d '{"organizationId":"<org uuid>","name":"seo-manager"}'
```

The response includes `token` once. Only the SHA-256 hash is stored. Revoke with `DELETE /api/bots/keys` and `{"organizationId","keyId"}`.

A missing or unknown key is **401**. A bot key sent to any other route, including the removed `POST /api/bots/time`, is **403**.

The key name is the bot. `seo-manager` is the only name that can create tasks. Any live key can look up clients and start, pause, resume, and stop timers. The key name comparison is case-insensitive.

## Look up clients

`GET /api/bots/clients`

Any non-revoked bot key can look up clients in its own organization. The lookup is read-only and needs only the bearer key and query parameters.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `name` | | Required when `id` is omitted. Use 2–200 characters after trimming whitespace. |
| `id` | | Client UUID for a direct lookup. Takes precedence when both `id` and `name` are supplied. |
| `match` | `exact` | Use `exact` for the full name or `contains` for a substring. Both match case-insensitively and treat search characters literally. |
| `status` | `current` | `current` includes `active`, `onboarding`, `pending`, and `paused`. Use `all` to include inactive clients. Applies to both name and ID lookups. |
| `limit` | `10` | Maximum results to return, from 1 to 25. |

```bash
curl --get https://seo-ops-center.vercel.app/api/bots/clients \
  -H 'Authorization: Bearer <minted-bot-token>' \
  --data-urlencode 'name=Ecoworkz'
```

The response contains `clients`, ordered by name, and a `truncated` flag that indicates when more matches exist. Each client has `id`, `name`, `website` (the stored domain, or `null`), the raw `status`, and `active`. `active` is `true` for the four current statuses. No matches return HTTP 200 with `{"clients": [], "truncated": false}`. Invalid query parameters return HTTP 400 with `invalid_request`.

## Create a task

`POST /api/bots/tasks`

Only the `seo-manager` key. Every other bot key is **403** `forbidden`.

An `inactive` client returns **409** `client_inactive` before any write or Basecamp read, including when the request supplies `basecampTodoId`. Clients in `active`, `onboarding`, `pending`, and `paused` can receive tasks.

| Field | Required | Meaning |
| --- | --- | --- |
| `idempotencyKey` | yes | 8–200 characters: letters, numbers, `:`, `_`, `.`, `-`. |
| `clientId` or `clientName` | one of them | `clientName` is an exact match inside the key's organization. |
| `taskTitle` | unless `basecampTodoId` is sent | Matches an existing task by exact, case-sensitive title. When importing a new task, this field overrides the Basecamp title. |
| `basecampTodoId` | no | Positive integer or string of digits for an existing top-level to-do in this client's configured Basecamp project. Omit both parent fields when sending it. |
| `parentTaskId` or `parentTitle` | no | Creates one subtask under that existing top-level task. `parentTitle` is exact. Send `parentTaskId` when more than one parent has that title. |
| `subtasks` | no | A list of `{ title, description?, category?, dueDate? }`, at most 20, titles unique in the call. Applies to the top-level task. Omit both parent fields when sending it. |
| `description` | no | Text up to 5,000 characters after trimming, with the same rules for each subtask. Blank text is omitted. Stored only on a new task. |
| `category` | no | Stored on `tasks.category` when the task is created. Omit it and the task is unlabeled. `content`, `technical`, `local`, `links`, `strategy`, `admin`, and `reporting` are always accepted. A label the client already uses, such as `SEO`, is accepted only as that exact string. |
| `dueDate` | no | `YYYY-MM-DD`. Also sent as the Basecamp due date when the to-do is created. |

One call does one of these:

- a solo task (`taskTitle` only)
- a parent and its subtasks (`taskTitle` plus `subtasks`)
- one subtask under an existing parent (`parentTaskId` or `parentTitle`, plus `taskTitle`)
- a link to an existing Basecamp to-do (`basecampTodoId`, with optional `taskTitle` and `subtasks`)

An exact title that already exists is returned with `created: false`. It is not duplicated. A title that matches more than one task is **409**.

Use descriptions for work instructions. Keep hours, minutes, elapsed time, budget figures, and other contract numbers out of every description. The API trims outer whitespace and includes the resulting text in the idempotency check. Each returned task and subtask has `descriptionApplied`, which is `true` when the API saved the supplied description on insert. An existing match keeps its description and returns `descriptionApplied: false`.

Without `basecampTodoId`, the app creates or reuses the parent's Basecamp to-do on the client's SEO Plan list. Subtasks become steps on that to-do. If sync is off or the SEO Plan list is missing, the tasks stay in SEO Ops.

The create push sends the saved description when it creates a Basecamp to-do. The Basecamp step writer accepts a title only, so subtask descriptions stay in SEO Ops.

When the parent already has a Basecamp to-do, the push checks its steps for each unlinked subtask. Titles must match exactly after trimming whitespace and ignoring case. A unique, unclaimed match is linked in SEO Ops and left untouched in Basecamp. A subtask with no match gets a new step.

The push leaves subtasks unlinked when multiple Basecamp steps match, multiple unlinked subtasks match the same step, or another task already links to the matching step. The response reports the count in `task.basecamp.subtasksSkipped` and explains the conflict in `task.basecamp.reason`. If the Basecamp step read fails, `task.basecamp.status` is `failed` and the push creates no steps.

```bash
curl -X POST https://seo-ops-center.vercel.app/api/bots/tasks \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <minted-bot-token>' \
  -d '{
    "idempotencyKey": "august-blogs",
    "clientName": "Ecoworkz",
    "taskTitle": "August blogs",
    "description": "Prepare drafts for the agreed topics.",
    "category": "content",
    "subtasks": [
      { "title": "Brief", "description": "List the audience and target queries.", "category": "content" },
      { "title": "Draft" }
    ]
  }'
```

### Link an existing Basecamp to-do

Send `basecampTodoId` to link an existing top-level task or import a new one. The to-do can be on any list in the client's configured Basecamp project, including Onboarding. This path requires only the configured project and creates no Basecamp to-do.

An exact `taskTitle` match links an unlinked app task. If the to-do already belongs to a task in this client and the title identifies no conflicting task, the response returns that task with `created: false` and preserves its title. With no matching task or existing link, the app imports the Basecamp title, description, due date, and completion state. A supplied `taskTitle`, `description`, or `dueDate` overrides the corresponding value on the new app task. A requested subtask description is also saved if a uniquely matching Basecamp step is imported as a new app task.

Migration 137 enforces one task per Basecamp recording in the database, including to-dos and steps. If a concurrent request claims a recording during a link or import, the bot returns `409 basecamp_todo_linked`.

Missing Basecamp steps are imported by recording ID. Requested subtasks reuse a unique step by trimmed, case-insensitive title, and new titles can create steps on the linked to-do. Ambiguous or already-claimed matches are reported in `task.basecamp.subtasksSkipped`. The response includes `task.linked: true` for this explicit link path and `false` for standard task creation. Returned subtasks include `basecampStepId` when the linked recording is known to be a step.

```json
{
  "idempotencyKey": "link-onboarding-12345",
  "clientName": "Ecoworkz",
  "basecampTodoId": "12345",
  "subtasks": [{ "title": "Connect Search Console" }]
}
```

| Status | Code | Condition |
| --- | --- | --- |
| 400 | `invalid_request` | Invalid `basecampTodoId`, or supplied with a parent field. |
| 400 | `basecamp_recording_is_step` | The ID is a Basecamp step. |
| 404 | `basecamp_todo_not_found` | No to-do with that ID was found in the configured project. |
| 409 | `basecamp_project_not_configured` | The client has no configured Basecamp project. |
| 409 | `basecamp_todo_linked` | The to-do is linked to a different task, client, or organization, the requested task has a different link, or a concurrent write claimed a recording during the request. |
| 502 | `basecamp_steps_unavailable` or `basecamp_step_sync_failed` | The step list could not be read or a new step could not be created. Retry with the same idempotency key. |

## Start a timer

`POST /api/bots/timer/start`

Any bot key. The task must already exist. This route never creates a task.

| Field | Required | Meaning |
| --- | --- | --- |
| `idempotencyKey` | yes | Same rules as create. A replay of the same body returns the original JSON. |
| `clientId` or `clientName` | one of them | Exact client in this organization. |
| `taskId` or `taskTitle` | one of them | `taskTitle` alone matches a top-level task. It does not match a subtask. |
| `parentTaskId` or `parentTitle` | no | With `taskTitle`, matches a subtask of that parent. |
| `description` | no | Becomes the running entry's note, and the timesheet note if stop does not send its own. |
| `countsTowardBudget` | no | Defaults to `true` for client work. |
| `billable` | no | Defaults to `true`. |
| `timeZone` | no | IANA zone for the calendar day. Defaults to `America/Los_Angeles`. |

A bot has one **running** timer. A paused timer does not use that slot.

- Starting the **same** task while that timer is running returns the running timer (`timer.alreadyRunning: true`). It does not reset the clock. Length does not matter.
- Starting a **different** task while a timer is running is **409** `timer_already_running`. The body includes the running timer. Pause or stop it, then start the other task. A long timer is not closed just so another task can start.
- Starting the **same** task that already has a paused timer is **409** `timer_paused`. Call resume. The body includes the paused timer.
- Starting a **different** task while this bot has paused timers is allowed. Those paused entries stay paused. Two bots can each have a running timer at the same time.
- When `BOT_TIMER_MAX_SECONDS` is set and the running timer is already past that cap, start closes it at the cap (see Length cap) and then starts the new one. The response includes `cappedTimer`. With no cap configured, start never does this.

The running row is an `in_progress` time log with `bot_key_id` set and `user_id` Carlos. It does not insert an open `time_log_segments` row, so it does not take his `one_open_time_segment_per_user` slot and his own timer keeps working. The floating timer does not show it. `description` on a running row is the note for the open stretch, when start sent one. The task title is not stored as a stretch note.

```bash
curl -X POST https://seo-ops-center.vercel.app/api/bots/timer/start \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <minted-bot-token>' \
  -d '{
    "idempotencyKey": "brief-start",
    "clientName": "Ecoworkz",
    "parentTitle": "August blogs",
    "taskTitle": "Brief"
  }'
```

## Pause a timer

`POST /api/bots/timer/pause`

Ends the running stretch and keeps the **same** time entry open with `status: "paused"`. The time so far is stored. Nothing is sent to Basecamp. A paused timer does not use the one-running slot.

| Field | Required | Meaning |
| --- | --- | --- |
| `idempotencyKey` | yes | A replay returns the original pause and does not write a second segment. |
| `taskId` | no | When sent, it must be the task the timer is on. A mismatch is **409** `timer_task_mismatch`. |
| `description` | no | Note for the stretch being closed. Kept after the note from start or resume. |

The response `timer.status` is `paused`. `timer.stretches` lists every closed stretch with `startedAt`, `endedAt`, and `note`. `timer.hours` and `timer.elapsedSeconds` are the true running time so far, however long the stretch ran. A pause does not flag the entry `needs_review` because it is long.

When `BOT_TIMER_MAX_SECONDS` is set and the running time is already past that cap, pause does not pause. The entry is capped (`needs_review`) and is not sent to Basecamp. The response has `capped: true`. With no cap configured, pause records the true running time and stays paused.

There is no running timer is **404** `timer_not_running`. A failure while reading the timer is **500** `timer_lookup_failed`. That is not a missing timer. The same request can be retried.

```bash
curl -X POST https://seo-ops-center.vercel.app/api/bots/timer/pause \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <minted-bot-token>' \
  -d '{
    "idempotencyKey": "brief-pause",
    "description": "Checked the top ten"
  }'
```

## Resume a timer

`POST /api/bots/timer/resume`

Opens a new stretch on the paused entry for `taskId`. The entry goes back to `in_progress`. Nothing is sent to Basecamp.

| Field | Required | Meaning |
| --- | --- | --- |
| `idempotencyKey` | yes | A replay returns the original resume and does not open another stretch. |
| `taskId` | yes | The paused timer to continue. |
| `description` | no | Note for the new stretch. |

- No paused timer on that task is **404** `timer_not_paused`.
- This bot already has a running timer is **409** `timer_already_running`.
- A configured cap that the paused entry has already reached is **409** `timer_cap_reached`. Stop it instead of resuming. With no cap configured, resume never returns this code, however long the paused entry already is.

```bash
curl -X POST https://seo-ops-center.vercel.app/api/bots/timer/resume \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <minted-bot-token>' \
  -d '{
    "idempotencyKey": "brief-resume",
    "taskId": "<task uuid>",
    "description": "Drafted the brief"
  }'
```

## Stop a timer

`POST /api/bots/timer/stop`

Stops the running timer, or a paused timer when nothing is running. Stop works from either state. The elapsed running time is stored the way a person stopping the drawer timer is stored: closed stretches, hours rounded to the hundredth, split into one row per local day when a stretch crosses midnight. Time spent paused is not counted. The time log stays on the subtask. Basecamp gets **one** push per day-row at stop, for that day's hours, on the parent to-do when the task is a subtask. Pause and resume never push to Basecamp.

| Field | Required | Meaning |
| --- | --- | --- |
| `idempotencyKey` | yes | A replay returns the original stop and does not post a second Basecamp entry. |
| `taskId` | no | When sent, it must be the task the timer is on. A mismatch is **409** `timer_task_mismatch`. Omit it to stop whatever is running. |
| `hours` | no | Corrected total as a positive JSON number in decimal hours, such as `0.75`. Only the 12 SEO bot key names listed under Complete a task without a timer may send it. |
| `description` | no | Stop note. Appended to the retained stretch notes or to the description edited in Timesheets. |
| `countsTowardBudget` | no | Falls back to the value from start. |
| `billable` | no | Falls back to the value from start. |
| `complete` | no | `true` marks the task done and completes the linked Basecamp to-do or step. |
| `completedOn` | no | `YYYY-MM-DD`, only with `complete: true`. A future day is rejected. |
| `timeZone` | no | IANA zone for the calendar day and the midnight split. Defaults to `America/Los_Angeles`. |

A normal stop is sent to Basecamp with `createIfMissing: true`, the same call the drawer makes when Send to Basecamp is on. `basecamp.status` is `pushed`, `skipped`, or `failed`. The timesheet **note** uses retained stretch notes in order, or the description set in Timesheets, followed by the stop note. If the result is empty, the note falls back to the task title. Time stays in the timesheet hours field.

When `hours` is supplied, stop keeps the earliest running time and removes time from the newest end first. Retained stretches keep their notes. Legacy carried seconds come before timestamped stretches and remain on their original date. Stop splits the retained time by local day after trimming and uses the rounded hours for each day's Basecamp entry. Stretches use millisecond precision with a minimum retained interval of one millisecond. Legacy carry uses whole seconds. Dated logs keep the existing whole-second elapsed totals and hundredth-hour rounding.

The maximum for `hours` is the lower of the timer's current running time (including an open stretch up to the stop request) and `BOT_TIMER_MAX_SECONDS` when configured. If the timer was edited in Timesheets, the bound uses the corrected stretches and any running time since then. A request above the bound returns **422** `hours_exceeds_running` and leaves the timer and Basecamp untouched. A request within the bound still follows the configured cap's review rule. If the timer was already past the cap, the corrected logs go to `needs_review` and their Basecamp timesheets are held for review. At exactly the cap, normal stop and sync apply.

`hours` is part of the stop request hash. A replay with the same value returns the original response. Changing the value with the same idempotency key returns **409** `idempotency_conflict`.

Omit `taskId` and a running timer is stopped. Omit `taskId` with nothing running and exactly one paused timer, and that paused timer is stopped. Several paused timers and no `taskId` is **409** `timer_ambiguous`. `taskId` of a paused timer stops that one and leaves a different running timer alone. A `taskId` that matches neither is **409** `timer_task_mismatch` when something is running, and **404** `timer_not_running` when nothing is.

There is nothing running or paused to stop (including when a configured cap sweep already closed the running timer) is **404** `timer_not_running`.

`complete: true` still marks the task done. It works from running or paused.

## Complete a task without a timer

`POST /api/bots/tasks/complete`

The allowed key names are `seo-manager`, `technical-seo`, `on-page-seo`, `content-writer`, `copy-humanizer`, `web-design-cro`, `seo-strategist`, `seo-revenue-framework`, `seo-aeo-desk`, `aeo-seo-bot`, `ai-search-visibility`, and `performance-watch`. Names are case-insensitive. Every other bot key receives **403** `forbidden`.

| Field | Required | Meaning |
| --- | --- | --- |
| `idempotencyKey` | yes | Same rules as create. |
| `taskId` | yes | UUID of an existing task in the key's organization. |
| `completedOn` | no | A real `YYYY-MM-DD` date. Omit it or send today's date to use the current instant. A past day is recorded at noon in `timeZone`. A future day returns **400** `completion_date`. |
| `timeZone` | no | IANA time zone. Defaults to `America/Los_Angeles`. |

A successful request returns **200** with `idempotencyKey`, `bot`, `actor`, `task` (`id`, `title`, `status`, `completedAt`, and [links](#response-links)), `completion`, and `alreadyDone`. The app records the status change by Carlos and completes the linked Basecamp to-do or step. `completion.status` is `pushed`, `skipped`, or `failed`. An unlinked task returns `skipped`. This route creates no time entry.

If the task is already done, `alreadyDone` is `true`, `completion.status` is `skipped`, and the task keeps its existing completion date and history. Repeating the same key and body returns the original response with `Idempotent-Replayed: true`, even if the current date or task has since changed. A new key checks the task again.

A missing task or a task in another organization returns **404** `task_not_found`. An inactive client returns **409** `client_inactive`. A running or paused timer on the task returns **409** `timer_open` and stays open. Stop the timer with `complete: true` using the key that owns it. Use a new idempotency key if you call standalone completion again after a conflict.

## Response links

Task objects in create, timer, and completion responses include `url`, an absolute `/tasks?task=<id>` link. Create includes the same field for each returned subtask. When a task is assigned to a Project, its response also includes `projectUrl`, which opens the Project in the client's workspace. The links use `NEXT_PUBLIC_SITE_URL`, defaulting to `https://seo-ops-center.vercel.app`.

Timer objects include `taskUrl`. A `timeLog` includes `taskUrl` when the response has no task object. A `cappedTimer` also has `taskUrl` for the task whose timer was capped.

## Length cap

There is **no maximum length** unless `BOT_TIMER_MAX_SECONDS` is set to a positive integer (whole seconds). Unset, blank, zero, and any other value mean unlimited. Pause, resume, and stop then record the true running time. A long timer is `logged` on stop, not `needs_review`, and it is sent to Basecamp the same way a short one is. Resume does not return `timer_cap_reached`.

`BOT_TIMER_MAX_SECONDS=7200` is the old two-hour cap. With a cap set, running time **longer than that many seconds** is stopped at exactly the cap. The cap is the sum of the stretches. Time spent paused does not count, and a paused timer is not capped by the sweep. A pause or stop exactly at the cap is not past it. One millisecond past it is. The entry's `status` is `needs_review`. It is not sent to Basecamp. Resume of a paused entry that has already reached the cap is **409** `timer_cap_reached`.

The owner sees a capped entry in two places:

- Timesheets, in a **Bot timer review** group. Those hours are not SEO budget time until they are accepted.
- The client activity feed, with a review label. Saving the entry, or sending it to Basecamp from the edit sheet, accepts it (`status` becomes `logged`).

There is no separate soft warning for a long timer. `needs_review` is only the configured cap.

When a cap is set, it does not wait for the bot to call stop.

- Start, resume, and standard task creation close an overdue **running** timer first. Pause and stop apply the cap in that response. Standalone completion leaves timers open.
- `GET` or `POST /api/cron/cap-bot-timers` closes every running bot timer past the cap. It does not close paused timers. With no cap configured, that sweep caps nothing and does not read running timers. A paused timer whose latest stretch ended at least seven days ago is still returned as `stalePaused` for review and is left paused. The sweep runs once a day (05:30 UTC). A bot that never calls back waits for that run. The saved duration is the configured cap of running time, not the time until the sweep noticed.

`basecamp.status` on a capped stop is `not_sent`.

## Which bot wrote the row

Bot rows keep `source = 'seo_pm'`. Filter them with `bot_key_id`:

```sql
select time_logs.*
from time_logs
join bot_api_keys on bot_api_keys.id = time_logs.bot_key_id
where bot_api_keys.name = 'seo-manager';
```

The same column on `tasks` marks tasks the bot created. A running timer is `time_logs.status = 'in_progress'` and `bot_key_id` set. A paused timer is `status = 'paused'` on that same row. A capped entry, only when `BOT_TIMER_MAX_SECONDS` is set, is `status = 'needs_review'`.

Paused and capped bot timers show in Timesheets. A paused entry is in **Paused bot timers** and is not SEO budget time until stop. Each stretch, with its start, end, and note, shows on the task. A human pause is unchanged: the row stays `in_progress`, the open segment is closed, and no `paused` status is written.

An organization owner or admin can use **Edit time** on a paused entry in Timesheets. Saving updates its running time and description and leaves it paused. Basecamp sync happens through the normal stop flow. The original running time bounds re-edits during the same pause, and time can be restored from the original stretches. Resuming commits that correction and starts a new stretch.

Trim audit on `time_logs` includes `trimmed_from_seconds` (the whole timer's original running seconds before correction, including time above a configured cap), `trimmed_at` (the latest trim timestamp), and the actor in `trimmed_by` (Timesheets session user) or `trimmed_by_bot_key_id` (bot stop key). Stop preserves audit on each finalized day row. Timesheets shows **Trimmed from X h** when audit is present.

## Idempotency

Send the same `idempotencyKey` and the same body again. The response is the original JSON with header `Idempotent-Replayed: true`.

A different body with the same key is **409** `idempotency_conflict`. Use a new key.

If a duplicate arrives while the first request is still running, the response is **409** `idempotency_in_progress`. Wait and send the same body again.

A key that already received a 4xx keeps that result. Fix the request under a new key.

A new start key, while the same task's timer is still running, is not a replay. It returns the running timer with `alreadyRunning: true`.

## Errors

| Status | `code` | Meaning |
| --- | --- | --- |
| 401 | `missing_api_key` | No `Authorization: Bearer` header. |
| 401 | `invalid_api_key` | The key is unknown, malformed, or revoked. |
| 403 | `forbidden` | The key called a route outside its scope, the body asked for a forbidden action, a bot other than `seo-manager` tried to create a task, or a key outside the SEO allowlist tried to complete a task without a timer or send `hours` on stop. |
| 400 | `invalid_json` | The body is not JSON. |
| 400 | `invalid_request` | A required field is missing or a value is invalid. Stop's `hours` must be a positive JSON number. |
| 400 | `unknown_field` | The body contains a field this route does not accept. |
| 400 | `completion_date` | `completedOn` is in the future or is not a real day. |
| 404 | `client_not_found` | No client in this organization matches. |
| 404 | `task_not_found` | No task matches. Timers never create one. |
| 404 | `timer_not_running` | Pause found nothing running, or stop found nothing running or paused. |
| 404 | `timer_not_paused` | Resume found no paused timer on that task. |
| 409 | `ambiguous_client` | More than one client has that exact name. Send `clientId`. |
| 409 | `client_inactive` | Task creation or standalone completion targeted an inactive client. |
| 409 | `ambiguous_task` | More than one task has that title, or the ids and titles disagree. |
| 409 | `timer_already_running` | This bot is already timing a different task, or resume was called while a timer is running. |
| 409 | `timer_paused` | Start targeted a task that already has a paused timer. Resume it. |
| 409 | `timer_open` | Standalone completion found a running or paused timer on the task. Stop it with `complete: true`. |
| 409 | `timer_cap_reached` | Resume targeted a paused timer that already reached `BOT_TIMER_MAX_SECONDS`. Stop it. Not returned when that variable is unset. |
| 409 | `timer_task_mismatch` | Pause or stop sent a `taskId` that is not the timer being closed. |
| 409 | `timer_ambiguous` | Stop omitted `taskId` and this bot has more than one paused timer. |
| 409 | `timer_changed` | The timer changed during stop. Check the timer and retry with a new idempotency key. |
| 409 | `idempotency_conflict` | This key was already used with a different body. |
| 409 | `idempotency_in_progress` | The same key is already running. |
| 409 | `actor_not_found` | Carlos Morones is not a member of the key's organization. |
| 422 | `hours_exceeds_running` | Stop's `hours` is above the current running time or configured cap. The timer stays open. |
| 500 | `internal` | The write failed after the key was accepted. A retry of the same body resumes the same operation. |
| 500 | `client_lookup_failed` | The client lookup could not be read. |
| 500 | `timer_lookup_failed` | The timer could not be read. This is not a missing timer. Retry the same request. |
