# Bot time API

SEO bots log time in SEO Ops Center over HTTP. The entry is attributed to Carlos Morones (`cmorones@marketingempiregroup.com`). The same server path the task drawer uses creates the Basecamp to-do (on the client's SEO Plan list), posts the timesheet entry, and completes the to-do.

This is not a Supabase key. A bot key cannot read the database, delete rows, or change settings. The service role stays on the server.

**Migration `migrations/113_bot_time_api.sql` is not applied.** Do not run it against the production project `sgszojorcftyaknruckh`. An owner applies it separately. Until that migration is applied, minting a key and calling this route will fail.

## Auth

Send this header on `POST /api/bots/time`:

```
Authorization: Bearer <minted-bot-token>
```

`<minted-bot-token>` is the `token` field from the mint response below. It is shown once and is not stored in this repository. Tokens use the prefix `seo_bot_`.

Keys are minted by an organization owner (dashboard session, not a bot key):

```bash
curl -X POST https://seo-ops-center.vercel.app/api/bots/keys \
  -H 'Content-Type: application/json' \
  -H "Cookie: <owner session>" \
  -d '{"organizationId":"<org uuid>","name":"ecoworkz"}'
```

The response includes `token` once. Only the SHA-256 hash is stored. Revoke with `DELETE /api/bots/keys` and `{"organizationId","keyId"}`.

A missing or unknown key is **401**. A bot key sent to any other route, or a body that asks for a delete or a settings change, is **403**.

## Log time

`POST /api/bots/time`

| Field | Required | Meaning |
| --- | --- | --- |
| `idempotencyKey` | yes | 8–200 characters: letters, numbers, `:`, `_`, `.`, `-`. Retries of the same body return the original result. |
| `clientId` or `clientName` | one of them | `clientName` is an exact match inside the key's organization. |
| `taskId` or `taskTitle` | one of them | `taskTitle` is an exact, case-sensitive match on a top-level task. |
| `createTask` | no | `true` creates the task when that exact title does not exist. A supplied `taskId` is never invented. |
| `category` | no | `content`, `technical`, `local`, `links`, `strategy`, or `admin`. Used when the task is created. |
| `dueDate` | no | `YYYY-MM-DD`. Used when the task is created, and sent as the Basecamp due date. |
| `date` | yes | `YYYY-MM-DD`. The day the work happened. Not in the future in `timeZone`. |
| `minutes` or `hours` | one of them | Whole minutes from 1 to 1440, or hours greater than 0 and at most 24 with two decimal places. 45 minutes is stored as 0.75 hours. |
| `description` | no | Up to 2000 characters. This is the Basecamp timesheet note. |
| `referenceLink` | no | An `http` or `https` URL stored on the time entry. |
| `countsTowardBudget` | no | **Counts toward SEO hours.** Defaults to `true`. `false` keeps the hour off the SEO budget. It does not by itself turn Basecamp off. |
| `billable` | no | Defaults to `true`. |
| `complete` | no | `true` marks the task done. |
| `completedOn` | no | `YYYY-MM-DD`. With `complete: true`, today uses the current time and any earlier day is stored at midday in `timeZone`. A future day is rejected. Omit it to complete as of now. |
| `timeZone` | no | IANA zone. Defaults to `America/Los_Angeles`. |

Basecamp follows the client, the same way the drawer does:

- Sync off, or no SEO Plan list: the task and the time stay in SEO Ops. Nothing is created in Basecamp.
- Sync on: the to-do is created on the SEO Plan list (`basecamp_todolist_id`), not the onboarding list.
- Time tracking off (`basecamp_timesheet_enabled` is not on, or the master sync flag is off): the time entry is saved and no timesheet row is posted.
- Counts toward SEO hours is the `counts_toward_budget` column. It is independent of the timesheet push.

Bot rows keep `source = 'seo_pm'` (they were written here, not imported). Filter them with `bot_key_id`:

```sql
select time_logs.*
from time_logs
join bot_api_keys on bot_api_keys.id = time_logs.bot_key_id
where bot_api_keys.name = 'ecoworkz';
```

The same column on `tasks` marks tasks the bot created.

## Example

The curl below is the body only. Add the `Authorization` header from the mint response. A literal token is omitted here so a placeholder is not committed.

```bash
curl -X POST https://seo-ops-center.vercel.app/api/bots/time \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotencyKey": "ecoworkz-brief-2026-11-03",
    "clientName": "Ecoworkz",
    "taskTitle": "Write the Ecoworkz brief",
    "createTask": true,
    "category": "content",
    "dueDate": "2026-11-04",
    "date": "2026-11-03",
    "minutes": 45,
    "description": "Drafted the brief",
    "referenceLink": "https://docs.google.com/document/d/brief",
    "countsTowardBudget": true,
    "complete": true,
    "completedOn": "2026-11-02",
    "timeZone": "America/Los_Angeles"
  }'
```

```json
{
  "idempotencyKey": "ecoworkz-brief-2026-11-03",
  "bot": "ecoworkz",
  "actor": {
    "email": "cmorones@marketingempiregroup.com",
    "userId": "…",
    "name": "Carlos Morones"
  },
  "task": {
    "id": "…",
    "title": "Write the Ecoworkz brief",
    "created": true,
    "status": "done",
    "completedAt": "2026-11-02T20:00:00.000Z",
    "basecampTodoId": "77",
    "basecamp": { "status": "pushed", "providerId": "77" }
  },
  "timeLog": {
    "id": "…",
    "date": "2026-11-03",
    "hours": 0.75,
    "minutes": 45,
    "countsTowardBudget": true,
    "billable": true,
    "description": "Drafted the brief",
    "basecampEntryId": "900",
    "basecamp": { "status": "pushed", "providerId": "900" }
  },
  "completion": { "status": "pushed" }
}
```

`basecamp.status` is `pushed`, `skipped`, or `failed`. `skipped` means the client's Basecamp settings did not allow that step. The SEO Ops rows are still saved.

## Idempotency

Send the same `idempotencyKey` and the same body again. The response is the original JSON with header `Idempotent-Replayed: true`. The retry does not create a second task, a second time entry, or a second Basecamp to-do or timesheet row.

A different body with the same key is **409** `idempotency_conflict`. Use a new key.

If a duplicate arrives while the first request is still running, the response is **409** `idempotency_in_progress`. Wait and send the same body again.

A key that already received a 4xx (not found, ambiguous name, and so on) keeps that result. Fix the request under a new key.

## Errors

| Status | `code` | Meaning |
| --- | --- | --- |
| 401 | `missing_api_key` | No `Authorization: Bearer` header. |
| 401 | `invalid_api_key` | The key is unknown, malformed, or revoked. |
| 403 | `forbidden` | The key was used on another route, or the body asked for something other than log time / create task / mark done (delete, settings, a different user, `action`). |
| 400 | `invalid_json` | The body is not JSON. |
| 400 | `invalid_request` | A required field is missing or a value is not usable (bad date, bad URL, minutes and hours disagree). |
| 400 | `unknown_field` | The body contains a field this route does not accept. |
| 400 | `completion_date` | `completedOn` is in the future or is not a real day. The message is `Pick today or a past day.` |
| 404 | `client_not_found` | No client in this organization matches `clientId` or the exact `clientName`. |
| 404 | `task_not_found` | No task matches, and `createTask` was not true. |
| 409 | `ambiguous_client` | More than one client has that exact name. Send `clientId`. |
| 409 | `ambiguous_task` | More than one task has that exact title, or `taskId` and `taskTitle` disagree. |
| 409 | `idempotency_conflict` | This key was already used with a different body. |
| 409 | `idempotency_in_progress` | The same key is already running. Retry the same body shortly. |
| 409 | `actor_not_found` | Carlos Morones is not a member of the key's organization, so the entry cannot be attributed. |
| 500 | `internal` | The write failed after the key was accepted. A retry of the same body resumes the same operation instead of inserting a second row. |
