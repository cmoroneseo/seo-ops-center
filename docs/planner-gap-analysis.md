# Planner — Gap Analysis vs ClickUp Planner

**Date:** 2026-07-28
**Method:** Read-only walkthrough of the live MEG SEO Department ClickUp Planner
(`app.clickup.com/9013904240/calendar`) compared against `/planner` on `feat/planner`.
Nothing in the ClickUp workspace was created, edited, dragged, or deleted.

**Not tested:** drag feel, snap increment, and auto-scheduling behaviour in ClickUp —
exercising those would have modified real calendar data.

---

## A. Settings we have no equivalent for

ClickUp exposes a full **Calendar settings** modal (Appearance / Accounts / Sidebar /
Upcoming meeting / Time blocking / AI Notetaker / Automations). We ship zero settings.

| Setting | ClickUp | Ours |
| --- | --- | --- |
| **Event style** | `Subtle` (outlined) or `Solid` — a user preference | Always translucent tint; solid only while dragging |
| **Grid size** | Default / Large / XL | Fixed `PX_PER_HOUR = 56` |
| **Default event duration** | Dropdown, currently 1 hour | Hardcoded 60 min |
| **Color tasks by** | None / (list, priority, status, assignee) | Tasks always render violet (`kind: 'focus'`) |
| **Start week on** | Sunday, configurable | Hardcoded Sunday via `startOfWeek()` |
| **Timezone** | Explicit user setting (`America/Los_Angeles`) | Browser timezone only |
| **Add timezone** | Second timezone column on the axis | Not supported |
| **Show weekends** | Toggle | Always 7 columns |
| **Show week numbers** | Toggle | Not supported |

Notable: ClickUp's **default** event style is Subtle, and Solid is opt-in. Our resting
cards are already close to Subtle, and the solid treatment we added for drag ghosts is
their Solid style. Making it a preference would match.

## B. Time-blocking behaviours we don't implement

From **Settings → Time blocking**:

1. **Show overdue tasks in the Planner board** — "Roll overdue tasks and reminders into
   today's column, alongside the ones due that day." We only surface overdue in the
   sidebar drawer; they optionally place them *on the grid*.
2. **Show future recurring tasks** — projects upcoming occurrences of recurring tasks
   onto the calendar. Our `Task` type already has a `recurrence` field; the planner
   ignores it entirely.
3. **Show tasks assigned to me with due date** — a master toggle, plus a
   "Show closed tasks" sub-option.
4. **Work schedule** — workspace-wide or custom per-day hours (Mon–Fri 9:00–17:00),
   used when auto-scheduling. We have no concept of working hours; the grid is a fixed
   7am–8pm window with no shading to distinguish work time from off-hours.
5. **Timeblock prefix** — blocks created from a task are titled `Work on <task>`,
   configurable. We use the bare task title.
6. **Default list for new tasks** — new planner tasks land in a chosen list
   (`Personal List`). Ours have no list/project and no client.
7. **Default Focus Time visibility** — configurable, currently `Private`. We hardcode
   focus blocks to private, so we're close, just not configurable.

## C. Grid and interaction differences

8. **Overlap layout is layered, not tiled.** ClickUp offsets overlapping cards and
   stacks them with the later one on top, partially covering the earlier — visible on
   Mon 10am (`Leadership` + `New Client Brief`), Thu 10am, and Mon 3pm
   (`Monthly Marketing Meeting` + `MEG H…`). We split into equal-width columns.
   This is the stagger described in our design doc that was never implemented.
9. **Short events render as compact single-line chips**, title and time inline —
   `Lunch 1pm`, `1:1 Carlos 11:45am`, `New Client Brief (Holder) 10am`. Our cards force
   a two-line layout and *hide* the time entirely under 45 minutes, which is backwards:
   the short ones are exactly where the inline time matters.
10. **Right-click context menu** on an event → 11-swatch colour palette + Delete.
    We have no context menu.
11. **Per-event colour override.** Their colour is per-event/per-calendar, not derived
    from a type. Our `planner_events` has no `color` column (it was cut from migration
    026); colour comes only from `kind`.
12. **4-day view** in addition to Day / Week / Month.
13. **Keyboard shortcuts** for views: `1`, `4`, `⇧W`, `⇧M`. We have none (only `Cmd+/`
    for the command bar).
14. **Sidebar collapse toggle** (`«`) and **sidebar search**, plus a per-section `⋯`
    menu. Ours is a fixed rail.
15. **Configurable sidebar sections** — show / hide / reorder / rename, and
    *add custom sections* backed by task filters. Our five sections are hardcoded.
16. **Priorities rows carry a status control** ("Change status") and a workspace status
    pill (`1 Priority`) pinned bottom-left. Ours are label-only.

## D. Calendar accounts and sync

17. Multiple connected Google accounts, teammates' calendars (`amiranda@`, `cmerideth@`,
    `janderson@`, +7 more), a holidays calendar, and workspace calendars
    (`Time off`, `Holidays`) — each with its own colour, visibility checkbox and `⋯`
    menu, plus a manual **Refresh**. This was deliberately scoped out of our build and
    remains the single largest structural difference.

## E. Out of scope / not worth chasing

18. **AI Notes** and **AI Notetaker** (meeting transcription).
19. **Automations**.
20. **Upcoming meeting** settings.

---

## Where we differ by design (not gaps)

- Our events link to a **client** (`client_id`), which ClickUp has no equivalent for —
  it links to lists. For an SEO agency this is the more useful axis.
- Dragging a scheduled task **off the grid** unschedules it back to the backlog. I did
  not find this affordance in ClickUp.
- We separate `scheduled_minutes` from `estimated_hours` (migration 028) so blocking
  time never rewrites an estimate. ClickUp's "Color tasks by" and time-block model
  suggests it treats these as one.

---

## Recommended order

**Cheap and high value**
1. Overlap stagger instead of equal-column tiling (§8) — matches the reference look.
2. Compact single-line chips for short events, with inline time (§9).
3. Overdue roll-forward into today's column (§1).
4. Working hours: configurable grid window + off-hours shading (§4).
5. Show-weekends toggle and start-of-week (§A).

**Medium**
6. Event style Subtle/Solid preference (§A).
7. Per-event colour override — needs a `color` column on `planner_events` (§11).
8. Recurring task projection — `Task.recurrence` already exists and is unused (§2).
9. View keyboard shortcuts and a 4-day view (§12, §13).
10. Configurable sidebar sections (§15).

**Explicitly deferred**
Google Calendar sync (§17), AI notetaker (§18), automations (§19).
