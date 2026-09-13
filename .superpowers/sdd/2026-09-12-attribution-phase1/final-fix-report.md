# Attribution Phase 1 — Final Fix Report

Base: `6a53c6865d4c961ce3b6df2d25b877ab8c22a45f` on `feat/attribution-design-spec`.

This is the single final-review repair wave. All 3 Critical, 8 Important, and 3 Minor findings are addressed. Migration 056 was corrected in place, and its complete attribution SQL is mirrored exactly in `schema.sql`. No additional migration, live database mutation, push, or PR was made.

## Finding-by-finding resolution

### Critical 1 — Public endpoint reachability

`middleware.ts` returns `NextResponse.next()` before any Supabase session work for the exact `/api/attribution/s.js` and `/api/attribution/collect` paths. The bypass is independent of HTTP method and does not use `isPublicRoute`, so an app auth cookie cannot redirect a script request to the dashboard.

Evidence: `public-paths.test.ts` invokes the real middleware with anonymous and auth-cookie requests for GET/POST/OPTIONS, and verifies that neighboring attribution routes and a workspace route still redirect to login.

### Critical 2 — Cross-origin transport

The delivered script uses `fetch` with `mode: 'cors'`, `credentials: 'omit'`, and `keepalive: true`. Its JSON preflight matches collector OPTIONS (`POST, OPTIONS` and `Content-Type`). All collector responses, including validation and server errors, carry wildcard ACAO and `Cache-Control: no-store`. Credentialed Beacon and synchronous XHR were removed.

Evidence: `public-paths.test.ts` executes the actual delivered JavaScript in a VM, inspects its transport options, exercises the actual OPTIONS handler, and confirms success/error CORS headers.

### Critical 3 — Tenant ownership

Migration 056 adds a composite client ownership key and a site `(client_id, organization_id)` foreign key. Events reference the same site/org tuple. Conversions reference both the exact site/org/client tuple and exact event/site/org tuple. Browser site grants restrict editable columns; members cannot move site ownership or set verification timestamps. Event/conversion writes remain service-role-only, with organization RLS for member reads.

Service-role query matching carries organization, client, and site from the conversion; rechecks the canonical site and client; and filters integrations and GSC days to that organization. The cron's query update is constrained by conversion ID, organization, client, and site.

Evidence: `schema.test.ts` executes the actual migration in isolated PGlite, rejects cross-org site creation, site/client reassignment, cross-org events and cross-site conversions, checks RLS and denied writes. `data-access.test.ts` asserts every tenant filter and that failed ownership checks never request history.

### Important 1 — Cron GET handlers

Both scheduled routes export `GET = POST`. CRON_SECRET bearer authorization, POST compatibility, cleanup retention filters, and per-conversion error isolation remain intact.

Evidence: `cron.test.ts` calls both real GET handlers. Missing, wrong, and unconfigured secrets return 401 before storage work; authorized GET executes query selection or pageview cleanup. GET and POST are asserted to reference the same handler.

### Important 2 — First-touch attribution and categories

The script stores the original referrer, three UTMs, session ID, and absolute landing page in a versioned per-site sessionStorage key. Every event sends explicit `initial_*` inputs. The collector classifies those inputs server-side; internal referrals resolve to the initial category, and an empty initial referrer stays direct. Existing payload fields remain accepted; the legacy raw `session_source` is classified or checked against the category allowlist. Browser-supplied organization/category fields are ignored. Event types and text-field shapes/lengths are validated before writes, and categories are constrained in both row mappers and SQL.

Evidence: `source-classifier.test.ts` covers direct, paid, organic, and AI continuity, raw legacy referrers, and invalid category values. `public-paths.test.ts` runs two actual script page loads with changed UTMs, then exercises collection. `schema.test.ts` rejects an arbitrary URL stored as a category.

### Important 3 — Exact, atomic conversions

Collection performs one event insert. The database's `AFTER INSERT` trigger materializes a conversion directly from `NEW`, copies the exact event ID and metadata, resolves the client through its site, and derives the UTC month from the event timestamp. `UNIQUE(event_id)` enforces one conversion per event. Any materialization failure rolls back the entire event statement and verification. No visitor/time-based event re-query remains.

The same trigger verifies the stored `site_domain` against the current active site while locked. `FOR NO KEY UPDATE` serializes receipts against domain changes while remaining compatible with foreign-key key-share locks from concurrent receipts.

Evidence: `schema.test.ts` inserts simultaneous same-visitor form/phone events and checks exact event IDs, types, source, pages, client, and month; rejects duplicate conversions; injects a conversion failure into a multi-row event statement and verifies zero partial events/conversions or verification changes. `public-paths.test.ts` verifies the collector sends only the one event batch.

### Important 4 — Monthly query aggregation

`rankQueries` sums clicks for each query across the normalized matching page before sorting and choosing the top three. Confidence uses all matched query totals, including queries outside the top three. Absolute landing pages additionally require the same hostname.

Evidence: `query-matcher.test.ts` uses repeated daily rows where the monthly winner differs from the largest single-day row, verifies total-click confidence, excludes other pages/hosts/subdomains, and preserves the existing path-normalization cases.

### Important 5 — Complete monthly facts

GSC facts are fetched in deterministic primary-key order with keyset pagination until no rows remain. Every request retains the validated day-ID set and `query_page` grain. The same pagination utility also removes the analogous default-row-cap risk from conversion reporting and cron selection. The day query cannot exceed 31 rows for an exact client/property/web month because the existing GSC schema uniquely constrains those dimensions.

Evidence: `data-access.test.ts` supplies 1,502 facts, places the monthly winner beyond row 1,000, checks successive ID cursors and final confidence, and separately verifies all 1,002 conversions appear in reporting and pending-query selection.

### Important 6 — GSC property/site identity

Inspected migration 049, the existing GSC history reader, the Google property helpers, and integration selection interfaces. The applicable exact identity is `client_integrations.credentials.site_url`, retained as `gsc_history_days.property`. Matching reads only the selected active/error GSC integration in the site's organization, applies the exact property and web search type to the month query, and verifies the landing page belongs to both the attribution site and that property. URL-prefix properties retain scheme, hostname and path prefix; domain properties retain exact domain/subdomain boundaries. Full landing URLs preserve the originating website across domain edits, and facts from another hostname cannot be merged by matching pathname alone.

Evidence: `domain.test.ts` and `data-access.test.ts` cover property reassignment, previous-domain conversions, URL-prefix paths/protocols, domain-property boundaries, and exact organization/property filters. No GSC credential token is selected or exposed to the browser.

### Important 7 — Actual installation verification

Accepted event insertion is now the only application path that stamps `verified_at`. The Verify Installation button reads the database receipt state through RLS and explains when no event has arrived. It never fetches the remote domain in opaque mode. Database column privileges prevent members from forging the timestamp; a domain update clears it in a trigger. The UI derives the badge directly from the latest site prop. The event's captured site-domain value and site lock reject batches prepared before a domain change.

Evidence: `schema.test.ts` proves denied timestamp writes, receipt-based stamping, domain invalidation, and rejection of old queued events. `data-access.test.ts` proves verification is read-only and needs a real timestamp, and checks the UI's current-site state wiring.

### Important 8 — SEO-only ROI

The ROI card receives only the explicit organic Google/Bing/other and AI ChatGPT/Perplexity/Google AIO counts. Paid, direct, social, referral, same-site, and invented prefix categories are excluded. Source breakdown, timeline, and log still receive all conversions. Revenue remains computed on read. The card's empty message explicitly refers to organic/AI conversions.

Evidence: `source-classifier.test.ts` verifies six eligible categories and excludes every other category; the fixture has 26 all-source conversions but only 12 SEO conversions, yielding $54,000 at $4,500 each. `data-access.test.ts` checks the ROI and all-source UI wiring.

### Minor 1 — Reporting errors

The source-count and landing-page helpers now use the error-propagating, paginated conversion reader. Database failures reject their promises and reach the existing dashboard error state instead of becoming empty charts.

Evidence: `data-access.test.ts` injects database failures into both helpers and checks the existing dashboard catch wiring.

### Minor 2 — HDYHAU radios

The script scans `select,input[type=radio]:checked`, preventing an unchecked first radio from becoming the recorded answer.

Evidence: the actual-script navigation/form test in `public-paths.test.ts` supplies an unchecked first radio and a later checked radio and verifies the selected answer.

### Minor 3 — Canonical domains

A shared parser canonicalizes user-entered web URLs/hosts to lowercase DNS hostnames, strips the www alias/trailing dot, and discards URL ports, paths, queries and fragments. It rejects invalid DNS, credentials, non-HTTP schemes, IP addresses, and missing hosts. Create/update and the setup UI use this parser; collector matching uses the same site-domain convention. SQL rejects noncanonical values from direct writes.

Evidence: `domain.test.ts`, `data-access.test.ts`, and `schema.test.ts` cover valid normalization, unusable input rejection, persisted payloads, host boundaries, and direct SQL constraints.

## Changed files

Production logic and routes:

- `middleware.ts`
- `app/api/attribution/collect/route.ts`
- `app/api/attribution/s.js/route.ts`
- `app/api/cron/attribution-queries/route.ts`
- `app/api/cron/attribution-cleanup/route.ts`
- `lib/attribution/domain.ts`
- `lib/attribution/source-classifier.ts`
- `lib/attribution/query-matcher.ts`
- `lib/supabase/attribution.ts`
- `lib/types.ts`
- `migrations/056_attribution.sql`
- `schema.sql`

UI:

- `components/attribution/AttributionSetup.tsx`
- `components/attribution/AttributionTab.tsx`
- `components/attribution/RoiCard.tsx`

Regression tests:

- `lib/attribution/cron.test.ts`
- `lib/attribution/data-access.test.ts`
- `lib/attribution/domain.test.ts`
- `lib/attribution/public-paths.test.ts`
- `lib/attribution/query-matcher.test.ts`
- `lib/attribution/schema.test.ts`
- `lib/attribution/source-classifier.test.ts`

Audit report: `.superpowers/sdd/2026-09-12-attribution-phase1/final-fix-report.md`.

## Commands and results

- Baseline `npm test`: 1,145/1,145 passed.
- Focused `node --import tsx --test lib/attribution/*.test.ts`: 54/54 passed.
- Final `npx tsc --noEmit`: exit 0, no diagnostics.
- Final `npm test`: 1,176/1,176 passed, no failures/skips/cancellations.
- Targeted `npx eslint middleware.ts app/api/attribution/collect/route.ts app/api/attribution/s.js/route.ts app/api/cron/attribution-queries/route.ts app/api/cron/attribution-cleanup/route.ts components/attribution/AttributionSetup.tsx components/attribution/AttributionTab.tsx components/attribution/RoiCard.tsx lib/attribution lib/supabase/attribution.ts lib/types.ts`: exit 0, no diagnostics.
- `git diff --check`: exit 0.
- Local Next.js HTTP smoke check: started `npm run dev -- --hostname 127.0.0.1 --port 3105`, then used Node fetch with `redirect: 'manual'`. GET script returned 200 with JavaScript content type and ACAO; collector OPTIONS returned 204 with ACAO; collector POST of an invalid empty payload returned 400 with ACAO; both cron GETs without authorization returned 401. No response redirected. The server was then stopped. These requests did not insert data. Initial sandbox socket restrictions required approved local-access escalation for the dev server and HTTP requests.

Intermediate test corrections: the cross-org insert fixture initially targeted a client that already owned a site, so the unique-client constraint fired before the intended composite FK; changed the fixture to an untracked foreign client. Error propagation assertions were adjusted to match PostgREST's structured error objects rather than a JavaScript Error string. Both now exercise the intended boundary and pass. The collector's logged server error during tests is an intentionally injected database failure.

## Self-review and residual concerns

Reviewed the whole implementation diff after the focused regressions, including database lock ordering, RLS/column grants, route entry points, property identity, and dashboard data wiring. No numbered finding remains open. The exact public bypass does not broaden authenticated-route access. Trigger functions use fixed search paths and invoker privileges; browser roles have no event/conversion writes. GSC facts derive their scope only from validated day IDs. Revenue is not stored.

Compatible extensions: collection accepts explicit first-touch fields and full URLs while still accepting the previous payload fields; event persistence now includes the canonical site domain; matching/update helpers accept an optional scope object that cron always supplies. Direct client-supplied verification timestamps were intentionally removed and replaced by `verifyAttributionSite` receipt reads.

Migration 056 has been executed only in isolated PGlite for regression verification, not on a live Supabase target. Authenticated live setup, a real installed client website, and live ingestion/dashboard QA remain the environment-specific follow-up already deferred in the progress ledger. Script execution and browser transport options were exercised in a VM, and real middleware/route handlers were invoked; this is not a claim of a full browser installation test. Existing upstream GSC import coverage limits and probabilistic-query semantics are unchanged.

The existing feature checkout is preserved. The executing-plans/finishing skills supplied the verification/reporting workflow; the explicit instruction to commit locally without push or PR determines the integration choice.
