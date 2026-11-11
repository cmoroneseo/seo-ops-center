# Bot timers on screen

A running bot timer is an `in_progress` `time_logs` row with `bot_key_id` set and `user_id` Carlos. It does not insert an open `time_log_segments` row, so it does not take `one_open_time_segment_per_user`. That stays true. The screen reads those rows and draws them the same way a timer Carlos started by clicking play is drawn. His own timer keeps working at the same time. Several bots can each have one running timer on different tasks.

Paused bot rows (`status = 'paused'`) show the same way a paused human timer shows. They still do not occupy the one-running slot.

## What shows where

Live elapsed is computed in the browser. Closed stretches are the segments with `ended_at` set. While the row is running, add `now - timer_started_at`. Paused time is the gap between stretches and is not added. The `hours` column stays 0 until pause or stop, so the clock does not read that column.

The screen does not name the bot. A running row is a pulsing dot and the live clock. A paused row is the paused clock.

| Place | What you see |
| --- | --- |
| SEO Plan row and Tasks list row | Pink running clock, or an amber paused clock. Idle rows stay `0h` with a grey play button. |
| Floating timer | Carlos's widget is unchanged and still uses his one open segment. Each bot timer is its own chip beside it: the task and the live clock. Paused bot timers sit in that same stack. |
| Task view | The same chip. The time-so-far total adds the live bot elapsed on top of already logged hours and ticks while the bot runs. A short run is shown in minutes so it does not read as 0.0h. Closed bot time is not SEO budget time until stop, so Timesheets and client budget totals do not count a running or paused bot row. |
| Timesheets | Unchanged. A paused row stays in Paused bot timers. A stop still lands as a normal entry, or in Bot timer review when the 2 hour cap fires. |

If Carlos already has his own timer on that same task, his play button still controls his timer. The bot timer is an extra chip so the two clicks do not hit the same entry. On any other task, his play button starts his timer as it does today.

## Controls

Only the organization owner can pause, resume, or stop a bot timer. That is the same owner check as the rest of the app: `organization_members.role = 'owner'`. Carlos Morones is that owner. Other members see the clock and do not see pause, resume, or stop.

The owner's controls call `POST /api/bots/timer/staff` with the signed-in session. A bot key is rejected on that route. Anyone who is not the owner gets 403. The route then runs the same pause, resume, and stop functions the bot API uses, including the 2 hour cap and `needs_review` (no Basecamp push when capped).

A stop from this route and a stop from `POST /api/bots/timer/stop` both go through that one close. Basecamp is pushed only when this call is the one that moves the row out of `in_progress` or `paused`. A second stop finds the row already closed and does not push again. Notes stay the stretch notes in order, then a stop note only when one was typed. Hours and timestamps stay out of the note text.

The bot HTTP API's request shape does not change. The staff route is the only new entry point.

## Refresh

The dashboard polls open bot timers about every 8 seconds while the tab is visible, and again on focus. A bot that starts a timer shows up without a reload. There is no realtime subscription.

## Task complete and delete

Marking a task done while a bot timer is open on it stops that timer first, through the same stop path (one Basecamp entry, cap rules unchanged), then marks the task done. The stop note stays empty. Nothing like "task completed" is written. A note is added only when someone typed one. If the stop fails, including when the person is not the owner, the task stays open.

Deleting a task is refused while a bot timer on it is running or paused. The message says to stop the running timer first. It does not name the bot. Delete does not push to Basecamp and does not drop the time on the floor. `time_logs.task_id` is `ON DELETE SET NULL`, so a delete that skipped this check would leave a running bot row with no task and would keep that bot's one-running slot. The check is in `deleteTask`, not a new constraint.

## Migration

None in this change. Display of a running timer needs `bot_key_id` and `timer_started_at` from migration 113, which is already in production. Pause, resume, and a stop that writes a stretch note need migration 127 (`paused` status and `time_log_segments.note`). Migration 114 is the one-running index. Both 114 and 127 stay **NOT APPLIED** and need their own approval. Until 127 is applied, the staff pause, resume, and stop writes fail in production the same way the bot pause route fails. The screen can still show a running row from 113.

## Risks

- The staff route uses the service role only after it checks that the signed-in user is the organization owner for the row's organization.
- Polling can be up to about 8 seconds behind a bot start.
- Two stops in the same moment are safe only because the status update is conditional and the push runs only for the call that changed the status.
- A task with two bots running shows his control if he has one, otherwise the running bot clock. Each bot still has its own floating chip.
- A member who is not the owner cannot mark that task done until the owner stops the bot timer.
