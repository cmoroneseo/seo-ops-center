# Bot API

SEO bots create tasks and run timers in SEO Ops Center over HTTP. Time is attributed to Carlos Morones (`cmorones@marketingempiregroup.com`, user `360c97ac-54fc-41fb-b660-0566d63c2e1b`). A stopped timer is a normal SEO Ops time entry: a closed session on `time_logs`, then the same Basecamp timesheet path the task drawer uses.

Bots do not log minutes after the fact. There is no `minutes` or `hours` field. `POST /api/bots/time` is gone.

A task this API creates is assigned to Carlos. The insert sets `assignee_id` and `assignee_ids` to his user id, `created_by` to the same id, and `status_history` to a `todo` entry by him. `priority` is `medium` and `tags` is empty. The SEO Plan reads `assignee_ids`. `assignee_id` is set to the same user so it is not left null.

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

The key name is the bot. `seo-manager` is the only name that can create tasks. Any other live key (`technical-seo`, and so on) can start, pause, resume, and stop timers. The comparison is case-insensitive.

## Create a task

`POST /api/bots/tasks`

Only the `seo-manager` key. Every other bot key is **403** `forbidden`.

| Field | Required | Meaning |
| --- | --- | --- |
| `idempotencyKey` | yes | 8–200 characters: letters, numbers, `:`, `_`, `.`, `-`. |
| `clientId` or `clientName` | one of them | `clientName` is an exact match inside the key's organization. |
| `taskTitle` | yes | The task to create. Exact and case-sensitive. |
| `parentTaskId` or `parentTitle` | no | Creates one subtask under that existing top-level task. `parentTitle` is exact. Send `parentTaskId` when more than one parent has that title. |
| `subtasks` | no | A list of `{ title, category?, dueDate? }`, at most 20, titles unique in the call. Creates those subtasks under `taskTitle`. Do not send this together with a parent. |
| `category` | no | Stored on `tasks.category` when the task is created. Omit it and the task is unlabeled. `content`, `technical`, `local`, `links`, `strategy`, `admin`, and `reporting` are always accepted. A label the client already uses, such as `SEO`, is accepted only as that exact string. |
| `dueDate` | no | `YYYY-MM-DD`. Also sent as the Basecamp due date when the to-do is created. |

One call does one of these:

- a solo task (`taskTitle` only)
- a parent and its subtasks (`taskTitle` plus `subtasks`)
- one subtask under an existing parent (`parentTaskId` or `parentTitle`, plus `taskTitle`)

An exact title that already exists is returned with `created: false`. It is not duplicated. A title that matches more than one task is **409**.

The parent's Basecamp to-do is created or reused on the client's SEO Plan list, the same way the app pushes a task. Subtasks become steps on that to-do. Sync off, or no SEO Plan list: the tasks stay in SEO Ops.

```bash
curl -X POST https://seo-ops-center.vercel.app/api/bots/tasks \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <minted-bot-token>' \
  -d '{
    "idempotencyKey": "august-blogs",
    "clientName": "Ecoworkz",
    "taskTitle": "August blogs",
    "category": "content",
    "subtasks": [
      { "title": "Brief", "category": "content" },
      { "title": "Draft" }
    ]
  }'
```

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
| `description` | no | Stop note. Appended after every stretch note. It is not a duration. |
| `countsTowardBudget` | no | Falls back to the value from start. |
| `billable` | no | Falls back to the value from start. |
| `complete` | no | `true` marks the task done and completes the linked Basecamp to-do or step. |
| `completedOn` | no | `YYYY-MM-DD`, only with `complete: true`. A future day is rejected. |
| `timeZone` | no | IANA zone for the calendar day and the midnight split. Defaults to `America/Los_Angeles`. |

A normal stop is sent to Basecamp with `createIfMissing: true`, the same call the drawer makes when Send to Basecamp is on. `basecamp.status` is `pushed`, `skipped`, or `failed`. The timesheet **note** is the stretch notes in order, then the stop note. Hours, minutes, and timestamps are not written into that note. Time stays in the timesheet hours field. If no note was sent, the note falls back to the task title.

Omit `taskId` and a running timer is stopped. Omit `taskId` with nothing running and exactly one paused timer, and that paused timer is stopped. Several paused timers and no `taskId` is **409** `timer_ambiguous`. `taskId` of a paused timer stops that one and leaves a different running timer alone. A `taskId` that matches neither is **409** `timer_task_mismatch` when something is running, and **404** `timer_not_running` when nothing is.

There is nothing running or paused to stop (including when a configured cap sweep already closed the running timer) is **404** `timer_not_running`.

`complete: true` still marks the task done. It works from running or paused.

## Length cap

There is **no maximum length** unless `BOT_TIMER_MAX_SECONDS` is set to a positive integer (whole seconds). Unset, blank, zero, and any other value mean unlimited. Pause, resume, and stop then record the true running time. A long timer is `logged` on stop, not `needs_review`, and it is sent to Basecamp the same way a short one is. Resume does not return `timer_cap_reached`.

`BOT_TIMER_MAX_SECONDS=7200` is the old two-hour cap. With a cap set, running time **longer than that many seconds** is stopped at exactly the cap. The cap is the sum of the stretches. Time spent paused does not count, and a paused timer is not capped by the sweep. A pause or stop exactly at the cap is not past it. One millisecond past it is. The entry's `status` is `needs_review`. It is not sent to Basecamp. Resume of a paused entry that has already reached the cap is **409** `timer_cap_reached`.

The owner sees a capped entry in two places:

- Timesheets, in a **Bot timer review** group. Those hours are not SEO budget time until they are accepted.
- The client activity feed, with a review label. Saving the entry, or sending it to Basecamp from the edit sheet, accepts it (`status` becomes `logged`).

There is no separate soft warning for a long timer. `needs_review` is only the configured cap.

When a cap is set, it does not wait for the bot to call stop.

- Every bot call except pause and stop closes an overdue **running** timer first. Pause and stop apply the cap in that response.
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
| 403 | `forbidden` | The key was used on another route, the body asked for a delete or a settings change, or a bot other than `seo-manager` tried to create a task. |
| 400 | `invalid_json` | The body is not JSON. |
| 400 | `invalid_request` | A required field is missing or a value is not usable. `minutes` and `hours` are not accepted. |
| 400 | `unknown_field` | The body contains a field this route does not accept. |
| 400 | `completion_date` | `completedOn` is in the future or is not a real day. |
| 404 | `client_not_found` | No client in this organization matches. |
| 404 | `task_not_found` | No task matches. Timers never create one. |
| 404 | `timer_not_running` | Pause found nothing running, or stop found nothing running or paused. |
| 404 | `timer_not_paused` | Resume found no paused timer on that task. |
| 409 | `ambiguous_client` | More than one client has that exact name. Send `clientId`. |
| 409 | `ambiguous_task` | More than one task has that title, or the ids and titles disagree. |
| 409 | `timer_already_running` | This bot is already timing a different task, or resume was called while a timer is running. |
| 409 | `timer_paused` | Start targeted a task that already has a paused timer. Resume it. |
| 409 | `timer_cap_reached` | Resume targeted a paused timer that already reached `BOT_TIMER_MAX_SECONDS`. Stop it. Not returned when that variable is unset. |
| 409 | `timer_task_mismatch` | Pause or stop sent a `taskId` that is not the timer being closed. |
| 409 | `timer_ambiguous` | Stop omitted `taskId` and this bot has more than one paused timer. |
| 409 | `idempotency_conflict` | This key was already used with a different body. |
| 409 | `idempotency_in_progress` | The same key is already running. |
| 409 | `actor_not_found` | Carlos Morones is not a member of the key's organization. |
| 500 | `internal` | The write failed after the key was accepted. A retry of the same body resumes the same operation. |
| 500 | `timer_lookup_failed` | The timer could not be read. This is not a missing timer. Retry the same request. |
