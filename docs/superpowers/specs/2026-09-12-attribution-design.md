# Attribution — Design Spec

**Date:** 2026-09-12
**Status:** Approved
**Author:** Carlos Morones + Claude

## Problem

SEO agencies lose 38% of clients annually. 53% of departing clients cite inability to demonstrate value. The root cause: no tool connects SEO project management to actual business outcomes (leads, calls, revenue). Existing tools either track traffic without conversions (Ahrefs Web Analytics), require per-client expert configuration (GA4), or are built for paid media teams where organic search is an afterthought (Ruler Analytics, HubSpot, HockeyStack).

AI search is accelerating the problem — Google AI Overviews appear on 47-64% of queries with 83% zero-click rates. Traffic can be flat while SEO is still driving business through brand awareness and the dark funnel. Agencies need attribution data that goes beyond pageviews.

## Solution

A lightweight, cookieless JavaScript tracking script installed on client websites that captures visits by source, form submissions, phone link clicks, and self-reported "how did you hear about us" responses. Combined with GSC query data already synced nightly, this produces a probabilistic query-to-conversion mapping that no other agency tool offers.

The Attribution tab on each client's workspace shows: which traffic sources drive conversions, which pages convert, which search queries likely led to each conversion, and the ROI calculation (leads × avg deal value vs retainer cost).

## Design Decisions

- **Own script over GA4 integration.** Full control, no consent banner needed, no sampling, no dependency on per-client GA4 configuration quality. First-party data becomes a product differentiator.
- **Cookieless, privacy-first.** No cookies, no localStorage for tracking, no fingerprinting. Uses `sessionStorage` for same-tab session continuity (dies on tab close). GDPR/CCPA compliant without consent banners.
- **Compute-on-read for revenue.** `avg_deal_value` stored on `clients` table, revenue calculated at query time (`COUNT(conversions) × avg_deal_value`). Matches existing pattern in `seo-ops-logic.ts`. Per-conversion value overrides deferred to future phase.
- **Workspace tab first.** Attribution data lives primarily in `workspace/[id]` as a tab alongside Deliverables, Marketing Plan, etc. Agency-wide `/attribution` rollup page deferred to Phase 3 — most daily usage happens in the client workspace.
- **Probabilistic query matching over exact queries.** Google encrypts organic search queries ("not provided" since 2011). We cross-reference each conversion's landing page with GSC click data for that page to produce "likely queries" with confidence scores. This leverages GSC data we already sync nightly.

## Tracking Script

### Installation

One line added to each client's website:

```html
<script defer src="https://seo-ops-center.vercel.app/api/attribution/s.js" data-site="CLIENT_SITE_ID"></script>
```

### Capabilities

| Signal | Method | Purpose |
|--------|--------|---------|
| Page view | Fires on every page load | Visit volume by source |
| Traffic source | `document.referrer` + UTM params | Organic vs Direct vs Referral vs Paid vs AI Search |
| AI Search detection | Referrer pattern matching | Detect ChatGPT, Perplexity, Google AIO referrals |
| Form submission | Global `submit` event listener on all `<form>` elements | Conversion tracking without per-form config |
| HDYHAU capture | Scans forms for select/radio fields matching patterns (`hear`, `found`, `source`, `referral`, `how_did`) | Self-reported attribution |
| HDYHAU injection | Opt-in per site; appends styled `<select>` to forms | For clients whose forms lack the field |
| Click-to-call | `tel:` link click listener | Phone lead attribution without CallRail |

### What It Does NOT Do

- No cookies, no localStorage (for tracking), no fingerprinting
- No PII captured — does not read form field values except HDYHAU fields
- No cross-site tracking
- No consent banner needed

### Session Tracking

Uses `sessionStorage` (not a cookie, dies on tab close, no consent required):
- On first pageview: generates a random `session_id`, stores `{session_id, source_category, landing_page}`
- All subsequent events in that tab inherit the original traffic source
- Prevents misattribution when visitors navigate internally (form submission on `/contact` correctly credits the original organic landing on `/services`)

### Event Batching

Events accumulate in memory. Flushed on:
- `visibilitychange` event (tab hidden or closed)
- 5 seconds of idle after last event
- Minimizes network requests — typically 1-2 POSTs per visit

### Script Delivery

Served from `/api/attribution/s.js` (Vercel serverless function):
- Returns minified JS with `Content-Type: application/javascript`
- Edge-cached (1 hour, revalidate on deploy)
- Script validates `window.location.hostname` matches registered domain

## Event Collection Endpoint

`POST /api/attribution/collect`

### Client-Side Payload

```json
{
  "site_id": "uuid",
  "events": [
    {
      "event_type": "pageview | form_submit | tel_click",
      "page_url": "/services/plumbing",
      "referrer": "https://www.google.com/",
      "session_id": "random-uuid",
      "hdyhau_value": "Search Engine",
      "utm_source": "google",
      "utm_medium": "organic",
      "utm_campaign": null,
      "device_type": "mobile",
      "timestamp": "2026-09-12T14:30:00Z"
    }
  ]
}
```

### Server-Side Enrichment

The endpoint adds fields the script cannot or should not compute:

- **`visitor_id`**: Hash of `request IP + User-Agent + daily rotating salt`, truncated. Raw IP never stored.
- **`source_category`**: Classified from referrer (see Source Classification below)
- **`country_code`**: From Vercel's `x-vercel-ip-country` request header

### Source Classification

| Referrer Pattern | Category |
|-----------------|----------|
| `google.*` (not ads/shopping path) | `organic_google` |
| `bing.com` | `organic_bing` |
| `yahoo.com`, `duckduckgo.com`, others | `organic_other` |
| `chat.openai.com`, `chatgpt.com` | `ai_chatgpt` |
| `perplexity.ai` | `ai_perplexity` |
| Google with AIO click indicators (referrer patterns TBD at implementation — Google's AIO click-through URLs are still evolving; will research actual referrer format) | `ai_google_aio` |
| `facebook.com`, `instagram.com`, `linkedin.com`, `twitter.com`, `x.com`, `tiktok.com` | `social` |
| UTM with `medium=cpc` or `medium=ppc` | `paid` |
| Same domain (internal navigation) | Inherits session source |
| No referrer, no UTM | `direct` |
| Everything else | `referral` |

### Security

- **Domain validation**: `Origin` or `Referer` header must match the registered domain for the `site_id`
- **Rate limiting**: 100 events per IP per minute
- **No auth token**: Script runs on public client websites — domain validation is the auth mechanism

### Conversion Materialization

When the endpoint receives a `form_submit` or `tel_click` event, it writes both:
1. The `attribution_events` row (raw event)
2. The `attribution_conversions` row (permanent record)

In the same transaction. Conversions appear in the dashboard immediately — no batch job delay.

## Data Model

### `attribution_sites`

One row per client website being tracked.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Used in `data-site` script attribute |
| `organization_id` | uuid FK → organizations | RLS scoping |
| `client_id` | uuid FK → clients | Links to existing client record |
| `domain` | text NOT NULL | e.g. `www.clientsite.com` — validates incoming events |
| `script_config` | jsonb | `{ hdyhau_inject: bool, hdyhau_field_patterns: string[], track_tel_clicks: bool }` |
| `is_active` | boolean DEFAULT true | Soft disable without deleting |
| `verified_at` | timestamptz | When installation was last verified |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

RLS: `organization_id IN (SELECT get_user_org_ids())`

### `attribution_events`

Every tracked event. High volume, 90-day retention on pageviews.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `organization_id` | uuid | RLS |
| `site_id` | uuid FK → attribution_sites | |
| `event_type` | text CHECK | `pageview` / `form_submit` / `tel_click` |
| `session_id` | text | Random UUID per browser tab session |
| `visitor_id` | text | Server-side hash (IP+UA+daily salt, truncated) |
| `source_category` | text | See Source Classification |
| `referrer_domain` | text | Raw referrer domain (nullable) |
| `landing_page` | text | First page of session (from sessionStorage) |
| `page_url` | text | Current page path at time of event |
| `hdyhau_response` | text | Self-reported value (nullable) |
| `utm_source` | text | |
| `utm_medium` | text | |
| `utm_campaign` | text | |
| `country_code` | text(2) | From request header |
| `device_type` | text | `desktop` / `mobile` / `tablet` |
| `created_at` | timestamptz | |

Indexes: `(site_id, created_at)`, `(site_id, event_type, created_at)`, `(organization_id)`

### `attribution_conversions`

Permanent conversion records. One per form submission or tel click.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `organization_id` | uuid | RLS |
| `site_id` | uuid FK → attribution_sites | |
| `client_id` | uuid FK → clients | Denormalized for fast queries |
| `event_id` | uuid FK → attribution_events | The source event |
| `conversion_type` | text CHECK | `form` / `phone` / `chat` (extensible) |
| `source_category` | text | Copied from event |
| `landing_page` | text | First page of the session |
| `page_url` | text | Page where conversion happened |
| `likely_queries` | jsonb | `[{query, clicks, confidence}]` — populated by daily cron |
| `hdyhau_response` | text | Copied from event |
| `month` | date | First of month — for monthly rollups |
| `created_at` | timestamptz | |

Indexes: `(client_id, month)`, `(site_id, created_at)`, `(organization_id)`

RLS on both event tables: `organization_id IN (SELECT get_user_org_ids())`

### Client table addition

Add `avg_deal_value numeric` (nullable) to `clients`. Revenue computed at query time: `COUNT(conversions) × avg_deal_value`.

## Daily Cron Jobs

### GSC Query Cross-Reference

**Schedule:** 3:00 AM CT daily (runs after existing 2:00 AM metric sync)
**Endpoint:** `/api/cron/attribution-queries`

For each `attribution_conversion` from the last 7 days with null `likely_queries`:
1. Take the conversion's `landing_page` path
2. Query `metrics` table for GSC rows matching that page + client in the same month
3. Rank queries by click count
4. Write top 3 into `likely_queries`: `[{query: "commercial plumber dallas", clicks: 43, confidence: 0.78}]`
5. Confidence = query clicks ÷ total clicks to that page

7-day lookback because GSC data lags 2-3 days. Idempotent — skips conversions with existing `likely_queries`.

### Event Retention Cleanup

**Schedule:** 4:00 AM CT daily
**Endpoint:** `/api/cron/attribution-cleanup`

- Deletes `attribution_events` rows older than 90 days where `event_type = 'pageview'`
- Keeps `form_submit` and `tel_click` events indefinitely (referenced by `attribution_conversions`)
- Logs count deleted

## Dashboard: Workspace Attribution Tab

New tab on `workspace/[id]`, alongside Deliverables, Marketing Plan, etc.

### Attribution Setup Card

Shown when no `attribution_site` exists for this client, or when the script is not yet verified:

1. **Domain input** — auto-filled from client record if available
2. **Script snippet** — generated with the client's `site_id`, copy button
3. **"Verify Installation" button** — fetches the client domain, checks for the script tag, shows green checkmark or red X with error
4. **Configuration toggles:**
   - Enable HDYHAU injection (default: off)
   - Enable tel click tracking (default: on)
5. **Average deal value input** — stored on `clients.avg_deal_value`, used for ROI calculation

### Attribution Dashboard (after setup)

**ROI Card** (if `avg_deal_value` set):
> SEO drove **23 leads** × $4,500 avg = **$103,500 pipeline** this month
> Retainer: $3,000 → **34.5x ROI**

**Source Breakdown Donut Chart:**
Organic Google | AI Search | Direct | Referral | Social | Paid — sized by conversion count

**Conversion Timeline:**
Daily or weekly bar chart of conversions, stacked by source category. Date range selector (default: current month).

**Conversion Log Table:**
| Date | Page | Source | Likely Queries | HDYHAU | Type |
|------|------|--------|---------------|--------|------|
| Sep 11 | /contact | Organic Google | commercial plumber dallas (78%), plumber near me (12%) | "Google Search" | Form |
| Sep 10 | /services | AI ChatGPT | — | — | Phone |

Sortable, filterable by source, type, date range.

**Landing Page Performance:**
| Page | Conversions | Top Query | Source Mix |
|------|------------|-----------|-----------|
| /contact | 12 | commercial plumber dallas | 🟢 78% organic |
| /services/emergency | 8 | emergency plumber | 🔵 45% AI search |

### Report Builder Integration (Phase 2)

New report section type: **"Attribution Summary"**
- Auto-populates from `attribution_conversions` for the report's date range
- Includes: total organic conversions, top converting pages, top likely queries, source breakdown chart, ROI calculation, MoM deltas
- Drops into existing section-based report builder

## Phasing

### Phase 1 — Core Attribution (MVP)

Ship the end-to-end loop:

- Migration: `attribution_sites`, `attribution_events`, `attribution_conversions` tables + `avg_deal_value` on clients
- Tracking script (`s.js`): pageviews, source classification, session tracking (sessionStorage), form listener, tel click listener
- Collection endpoint (`/api/attribution/collect`): ingestion, server-side visitor hash, domain validation, rate limiting
- GSC query cross-reference cron job
- Event retention cleanup cron job
- Workspace Attribution tab: setup card, source donut, conversion timeline, conversion log with likely queries, landing page performance, ROI card
- Row mappers and types in `lib/types.ts`, CRUD in `lib/supabase/attribution.ts`

**Rollout:** Deploy to Sandbox Client A first, validate data flows end-to-end, then enable for 2-3 real clients, then agency-wide.

### Phase 2 — HDYHAU Injection + Reporting

- HDYHAU injection (opt-in, styled dropdown appended to client forms that lack the field)
- Advanced HDYHAU field pattern matching (broader detection beyond default patterns)
- Report Builder "Attribution Summary" section
- "SEO saved you $X in ad spend" metric using Ahrefs CPC data already synced
- MoM delta comparisons on all attribution metrics

### Phase 3 — Agency Rollup + Client-Facing

- `/attribution` top-level page in left nav — agency-wide KPI strip, all-clients conversion table, sparklines, sort/filter
- My Clients lens (filtered to logged-in team member's assigned clients)
- Client portal view (magic link auth, simplified read-only attribution dashboard)

### Phase 4 — Advanced Attribution

- Call tracking integration (CallRail API) for phone call attribution beyond tel click detection
- Multi-touch attribution — weight credit across multiple organic visits before conversion
- AI Search trend reporting — track shift from traditional organic to AI-referred traffic over time
- CRM integration (GoHighLevel / HubSpot) for closed-deal revenue attribution

## Volume Estimates

~50 clients × ~500 visits/day average = ~25,000 events/day = ~750,000/month.

With 90-day retention on pageviews: ~2.25M rows max in `attribution_events` at steady state. Well within Supabase capacity.

`attribution_conversions` grows at ~50 clients × ~20 conversions/month = ~1,000 rows/month = ~12,000/year. Trivial.

## Key Files (planned)

- `lib/types.ts` — `AttributionSite`, `AttributionEvent`, `AttributionConversion` types
- `lib/supabase/attribution.ts` — CRUD + row mappers
- `lib/attribution/source-classifier.ts` — referrer → source_category logic (shared between script and server for testing)
- `lib/attribution/query-matcher.ts` — GSC cross-reference logic
- `app/api/attribution/s.js/route.ts` — script delivery endpoint
- `app/api/attribution/collect/route.ts` — event ingestion endpoint
- `app/api/cron/attribution-queries/route.ts` — daily GSC cross-reference
- `app/api/cron/attribution-cleanup/route.ts` — daily event retention cleanup
- `components/attribution/AttributionTab.tsx` — workspace tab orchestrator
- `components/attribution/AttributionSetup.tsx` — setup card (snippet, verify, config)
- `components/attribution/SourceDonut.tsx` — source breakdown chart
- `components/attribution/ConversionTimeline.tsx` — daily/weekly bar chart
- `components/attribution/ConversionLog.tsx` — conversion table with likely queries
- `components/attribution/LandingPagePerformance.tsx` — page-level conversion data
- `components/attribution/RoiCard.tsx` — ROI calculation display
- `migrations/040_attribution.sql` — schema migration
- `public/attribution/s.min.js` — (build artifact) minified tracking script source
