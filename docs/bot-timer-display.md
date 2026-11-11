# Bot timers on screen

A running bot timer is an `in_progress` `time_logs` row with `bot_key_id` set and `user_id` Carlos. It does not insert an open `time_log_segments` row, so it does not take `one_open_time_segment_per_user`. That stays true. The screen reads those rows and draws them the same way a timer Carlos started by clicking play is drawn. His own timer keeps working at the same time. Several bots can each have one running timer on different tasks.

Paused bot rows (`status = 'paused'`) show the same way a paused human timer shows. They still do not occupy the one-running slot.

## What shows where

Live elapsed is computed in the browser. Closed stretches are the segments with `ended_at` set. While the row is running, add `now - timer_started_at`. Paused time is the gap between stretches and is not added. The `hours` column stays 0 until pause or stop, so the clock does not read that column.

| Place | What you see |
| --- | --- |
| SEO Plan row and Tasks list row | Pink running clock and a pause control, or an amber paused clock and Resume. A badge names the bot, for example `seo-manager bot`. Idle rows stay `0h` with a grey play button. |
| Floating timer | Carlos's widget is unchanged and still uses his one open segment. Each running bot timer is its own chip beside it, with the badge, the task, the live clock, Pause, and Stop. Paused bot timers sit in that same stack so Resume is there. |
| Task view | The same clock, badge, Pause or Resume, and Stop. The "time logged" total adds the live bot elapsed on top of already logged hours and ticks while the bot runs. Closed bot time is not SEO budget time until stop, so Timesheets and client budget totals do not count a running or paused bot row. |
| Timesheets | Unchanged. A paused row stays in Paused bot timers. A stop still lands as a normal entry, or in Bot timer review when the 2 hour cap fires. |

If Carlos already has his own timer on that same task, his play button still controls his timer. The bot timer is an extra chip on the row so the two clicks do not hit the same entry. On any other task, his play button starts his timer as it does today.

## Controls

Pause, resume, and stop from the UI call `POST /api/bots/timer/staff` with the signed-in session. That route is not a bot-key route. It loads the row and runs the same pause, resume, and stop functions the bot API uses, including the 2 hour cap and `needs_review` (no Basecamp push when capped).

A stop from this route and a stop from `POST /api/bots/timer/stop` both go through that one close. Basecamp is pushed only when this call is the one that moves the row out of `in_progress` or `paused`. A second stop finds the row already closed and does not push again. Notes stay the stretch notes in order, then the stop note. Hours and timestamps stay out of the note text.

The bot HTTP API's request shape does not change. The staff route is the only new entry point.

## Refresh

The dashboard polls open bot timers about every 8 seconds while the tab is visible, and again on focus. A bot that starts a timer shows up without a reload. There is no new realtime publication.

## Task complete and delete

Marking a task done while a bot timer is open on it stops that timer first, through the same stop path (one Basecamp entry, cap rules unchanged), then marks the task done. If the stop fails, the task stays open.

Deleting a task is refused while a bot timer on it is running or paused. The message names the bot and says to stop it first. Delete does not push to Basecamp and does not drop the time on the floor. `time_logs.task_id` is `ON DELETE SET NULL`, so a delete that skipped this check would leave a running bot row with no task and would keep that bot's one-running slot. The check is in `deleteTask`, not a new constraint.

## Migration

None in this change. Display of a running timer needs `bot_key_id` and `timer_started_at` from migration 113, which is already in production. Pause, resume, and a stop that writes a stretch note need migration 127 (`paused` status and `time_log_segments.note`). Migration 114 is the one-running index. Both 114 and 127 stay **NOT APPLIED** and need their own approval. Until 127 is applied, the staff pause, resume, and stop writes fail in production the same way the bot pause route fails. The screen can still show a running row from 113.

## Risks

- The staff route uses the service role after it checks that the caller is a member of the row's organization. A member who can see the task can pause or stop that bot timer. The time stays on Carlos.
- Polling can be up to about 8 seconds behind a bot start.
- Two stops in the same moment are safe only because the status update is conditional and the push runs only for the call that changed the status.
- A task with two bots running shows his control if he has one, otherwise the running bot clock plus a chip per extra bot.

## Open questions

- Should Abel be able to pause or stop a bot timer, or only Carlos?
- When a task is marked done, should the stop note say that the task was completed, or stay empty unless someone typed one?
- Is an 8 second poll enough, or do we want a Supabase realtime subscription later (no schema change, but a publication change on the project)?
