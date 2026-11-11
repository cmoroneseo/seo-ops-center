# SEO Change Log + Impact Tracker

Short spec. Draft only. Migration 125 is written in a later commit and is **not applied**.

## What this is

A client log of SEO changes (an H1 edit, a content refresh, a new page, a CRO block) and a read of what Search Console and GA4 did afterward.

The Results ledger (`lib/search-reporting/ledger.ts`, `ResultsView`) already compares 28 days after a shipped deliverable with 28 days before. This feature does not replace that ledger. It logs changes that are not deliverables, keeps the before/after text, and adds checkpoints, a control, and a plain verdict.

## What we reuse

- GSC history: `gsc_history_days` + `gsc_history_facts` (grains `property`, `page`, `query_page`; surface `organic`). The history writer already refuses dates newer than 3 Pacific days (`replace_gsc_history_day`).
- Live URL snapshots (`gsc_live_url_*`) stay on the deliverable path. The change log reads history, not a second sync.
- GA4 history: `ga4_history_days`, `ga4_daily` (sitewide organic sessions and key events), `ga4_landing_page_days` (the page). Property ids stay `properties/{id}` from the existing Google connection. No new OAuth. No token in the log.
- Date math: `dateOffset`, `ptToday`, `eachDate`, `sumMetrics` (impression-weighted position, CTR from totals).
- Nav: a Changes row under Search performance on the client workspace (`?tab=changes`).
- Credentials: the app's `client_integrations` row (`site_url`, `property_id` only). Never a box file, never Ahrefs, never a Semrush call.

Rollups are computed on read. The one stored snapshot is the baseline captured at log time, so a later Search Console revision can be seen next to what we recorded.

## Data model (migration 125, not applied)

Staff-authored. Every row has `organization_id` and `client_id`. RLS: `organization_id in (select get_user_org_ids())`. Anon has no grants. Members can read and write their org. The API rejects viewers on create and delete. No seed rows.

| Table | Holds |
|---|---|
| `seo_changes` | Type, title, before/after text, `live_at`, approver name, backup reference, revert instructions, primary KPI, last-year flag, author |
| `seo_change_pages` | URL, normalized key, label, optional CMS page id and widget id |
| `seo_change_queries` | Target query and a normalized key |
| `seo_change_baselines` | One row per change. Status `captured` / `partial` / `missing`. JSON payload of the 28-day read at log time. Not updated later |

Change types: `title`, `h1`, `meta`, `content_refresh`, `internal_links`, `schema`, `new_page`, `redirect`, `cro_block`, `other`.

KPIs: `clicks`, `impressions`, `ctr`, `avg_position`, `organic_sessions`, `key_events`.

A trigger rejects a page or query whose client does not match the change.

## Screens

Client workspace → **Changes**.

1. **Timeline.** Date, type, page, verdict badge, primary delta. Filters: page, change type, date range. The client is the open workspace client (the switcher changes client).
2. **Log a change.** The fields in the goal. Live date and time are Pacific. Example mode does not save.
3. **Detail.** KPI cards at 7, 14, 28, and 56 days. Trend chart with a marker on the live date. Page vs control. Sortable query table. Other changes in the window. Revert opens the stored instructions and does not edit the site. Next-test line. CSV download. Print / Save PDF uses the print stylesheet.

Empty, loading, and “migration not applied” states are real screens. Example data is labeled on the page.

## Read path

`GET/POST /api/clients/[id]/changes` and `GET /api/clients/[id]/changes/[changeId]`.

Membership comes from `requireClientOrgMember`. Queries are scoped to that organization and client. The route selects `credentials->>'site_url'` and `credentials->>'property_id'` only.

On create, the row is saved even if the baseline read fails. The baseline is then marked `missing` and the detail says so.

Windows (Pacific dates):

- Baseline: 28 days before the live date. The live date is the first day after.
- Checkpoints: 7, 14, 28, 56 days after, inclusive.
- Optional baseline: the same calendar dates one year earlier.
- Final data runs through today minus 3 Pacific days. Newer days are left off the totals and called out. Missing days are not zeros.

Control, in order:

1. Untouched pages: sitewide property total minus the changed URLs, for clicks, impressions, CTR, organic sessions, and key events.
2. If that subtraction goes negative, or the KPI is average position (position cannot be subtracted), use the sitewide trend and say so.
3. If there is no sitewide series, there is no control. The verdict says it is the page alone.

Query rows are the target queries on the logged URLs. They are a subset of the page total because Google hides some queries.

## Verdict

Documented in `lib/change-log/thresholds.ts` and tested.

The badge uses the longest checkpoint that is actually finished (the end date is final, and at least 80% of those days are stored). Under 7 finished days, or a baseline with fewer than 21 of 28 days stored, the verdict is **Too early**.

Compare daily rates so a 7-day window is not judged against a 28-day total. Position is lower-is-better. A rank move under 1.0 is noise.

| Verdict | Rule |
|---|---|
| Improved | The page moved the helpful way, and it beat the control by at least 10 percentage points |
| Declined | The page moved the harmful way, and it lagged the control by at least 10 percentage points |
| Flat | Inside that band, or the rest of the site moved with it |
| Too early | The checkpoint or the baseline is not ready, or the source is not connected |

No control: the page itself must move at least 15% or the verdict stays flat.

Low data (page impressions under 100 in either window, or the primary count under its floor) still gets a verdict, marked **Estimate**. Partial coverage is an estimate too.

Copy never says the change caused the move. The detail line is: “Lines up with the change. Does not show the change caused it.”

## Example data

`lib/change-log/fixture.ts` and `?tab=changes&example=1`. Not inserted.

Ecoworkz homepage H1, page 7901, widget `47eaa58`. Before: “Hardscape, Landscape & Outdoor Living Contractors in Corona, CA”. After: “Hardscape & Landscape Contractors in Corona, CA”. Live Nov 10, 2026, 2:04 PM PT. Approved by Carlos. Backup: Elementor template 11115. Revert: set the widget back to the long H1. Queries: hardscape contractors corona, landscape contractors corona, corona landscaping. A same-day CRO example (El Niño promo, 1:28 PM PT) is included so the overlap shows up. Performance numbers in the example are synthetic so the chart, control, and badges can be reviewed before any final Search Console days exist. The page says that.

On the real clock (Nov 10, 2026) this change is too early: Search Console is still about 3 days behind, and the after window has not started.

## API needs that already exist

No new Google scope. No new cron. Nightly GSC and GA4 syncs keep filling history. The change log reads it.

## Caveats

- Correlation only. A control reduces the chance we credit a sitewide or seasonal swing. It is not a causal test.
- GSC page totals and query totals do not match. Anonymized queries are missing.
- The GBP-tagged homepage URL is a different row. A logged URL with no query string does not claim `?utm_medium=gbp` rows. v1 tracks the URLs that were typed in.
- Same dates last year are context on the detail. The verdict still uses the 28 days immediately before the change, plus the control.
- GA4 is whatever is connected. A client with no property (Kentina) shows “Analytics isn’t connected” on those cards. Ecoworkz’s property, when connected, is `properties/296973560`.
- Last year needs stored history. If those days are not there, the option says so instead of drawing a zero.
- Revert is instructions. This app does not write to WordPress or Elementor.
- PDF is the browser print dialog. A generated PDF file is a follow-up.
- The migration is not applied in this PR. Until it is, the tab explains that and offers the labeled example.

## Open questions

1. Are the 10-point control band and the 15% no-control band the ones you want kept?
2. Should the El Niño promo be logged as its own change on Ecoworkz once the migration is applied, so the real H1 read shows it as a confounder?
3. Should viewers be able to log a change? This draft lets members, admins, and owners log, and viewers read.
4. Do you want an agency-wide timeline, or is the client page enough?
5. Apply migration 125 only after review. It creates the four tables, RLS, and the scope trigger. It does not insert the Ecoworkz row.
