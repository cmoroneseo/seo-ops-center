# Bot API

SEO bots create tasks and run timers in SEO Ops Center over HTTP. Time is attributed to Carlos Morones (`cmorones@marketingempiregroup.com`, user `360c97ac-54fc-41fb-b660-0566d63c2e1b`). A stopped timer is a normal SEO Ops time entry: a closed session on `time_logs`, then the same Basecamp timesheet path the task drawer uses.

Bots do not log minutes after the fact. There is no `minutes` or `hours` field. `POST /api/bots/time` is gone.

A task this API creates is assigned to Carlos. The insert sets `assignee_id` and `assignee_ids` to his user id, `created_by` to the same id, and `status_history` to a `todo` entry by him. `priority` is `medium` and `tags` is empty. The SEO Plan reads `assignee_ids`. `assignee_id` is set to the same user so it is not left null.

This is not a Supabase key. A bot key cannot read the database, delete rows, or change settings. The service role stays on the server.

**Migration `migrations/114_bot_running_timer.sql` is not applied.** Do not run it against the production project `sgszojorcftyaknruckh`. An owner applies it separately. It adds one unique index so a bot cannot have two running timers. The routes work before that index; the index closes a race between two starts. Migration 113 (bot keys, `bot_key_id`) is already in production.

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

The key name is the bot. `seo-manager` is the only name that can create tasks. Any other live key (`technical-seo`, and so on) can start and stop timers. The comparison is case-insensitive.

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

A bot has one running timer.

- Starting the **same** task while that timer is still under two hours returns the running timer (`timer.alreadyRunning: true`). It does not reset the clock.
- Starting a **different** task while a timer is under two hours is **409** `timer_already_running`. The body includes the running timer. Stop it, then start the other task.
- Starting anything while the running timer is **already past two hours** closes that timer at the cap (see below) and then starts the new one. The response includes `cappedTimer`.

The running row is an `in_progress` time log with `bot_key_id` set and `user_id` Carlos. It does not take his open timer slot, so his own timer keeps working. The floating timer does not show it.

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

## Stop a timer

`POST /api/bots/timer/stop`

Stops the timer this key has running. The elapsed time is stored the way a person stopping the drawer timer is stored: one closed session, hours rounded to the hundredth, split into one row per local day when the session crosses midnight. The time log stays on the subtask. Basecamp gets the time on the parent to-do when the task is a subtask, which is the same rule the drawer uses.

| Field | Required | Meaning |
| --- | --- | --- |
| `idempotencyKey` | yes | A replay returns the original stop and does not post a second Basecamp entry. |
| `taskId` | no | When sent, it must be the task the timer is on. A mismatch is **409** `timer_task_mismatch`. Omit it to stop whatever is running. |
| `description` | no | Timesheet note. Falls back to the note from start, then the task title. |
| `countsTowardBudget` | no | Falls back to the value from start. |
| `billable` | no | Falls back to the value from start. |
| `complete` | no | `true` marks the task done and completes the linked Basecamp to-do or step. |
| `completedOn` | no | `YYYY-MM-DD`, only with `complete: true`. A future day is rejected. |
| `timeZone` | no | IANA zone for the calendar day and the midnight split. Defaults to `America/Los_Angeles`. |

A normal stop is sent to Basecamp with `createIfMissing: true`, the same call the drawer makes when Send to Basecamp is on. `basecamp.status` is `pushed`, `skipped`, or `failed`.

There is no running timer (including when the sweep already stopped it) is **404** `timer_not_running`.

## Two-hour cap

A timer that runs **longer than two hours** is stopped at exactly two hours. The entry's `status` is `needs_review`. It is not sent to Basecamp.

The owner sees it in two places:

- Timesheets, in a **Bot timer review** group. Those hours are not SEO budget time until they are accepted.
- The client activity feed, with the label "Review — stopped at 2 hours". Saving the entry, or sending it to Basecamp from the edit sheet, accepts it (`status` becomes `logged`).

The cap does not wait for the bot to call stop.

- Every bot call for that key closes an overdue timer first.
- `GET` or `POST /api/cron/cap-bot-timers` closes every overdue bot timer. It runs once a day (05:30 UTC). A bot that never calls back waits for that run. The saved duration is still two hours from the start, not from when the sweep noticed.

`basecamp.status` on a capped stop is `not_sent`.

## Which bot wrote the row

Bot rows keep `source = 'seo_pm'`. Filter them with `bot_key_id`:

```sql
select time_logs.*
from time_logs
join bot_api_keys on bot_api_keys.id = time_logs.bot_key_id
where bot_api_keys.name = 'seo-manager';
```

The same column on `tasks` marks tasks the bot created. A running timer is `time_logs.status = 'in_progress'` and `bot_key_id` set. A capped entry is `status = 'needs_review'`.

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
| 404 | `timer_not_running` | Stop found nothing running for this bot. |
| 409 | `ambiguous_client` | More than one client has that exact name. Send `clientId`. |
| 409 | `ambiguous_task` | More than one task has that title, or the ids and titles disagree. |
| 409 | `timer_already_running` | This bot is already timing a different task. |
| 409 | `timer_task_mismatch` | Stop sent a `taskId` that is not the running task. |
| 409 | `idempotency_conflict` | This key was already used with a different body. |
| 409 | `idempotency_in_progress` | The same key is already running. |
| 409 | `actor_not_found` | Carlos Morones is not a member of the key's organization. |
| 500 | `internal` | The write failed after the key was accepted. A retry of the same body resumes the same operation. |
