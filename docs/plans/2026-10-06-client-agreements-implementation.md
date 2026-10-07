# Client agreements implementation

Extend the existing staff workspace with current agreement summary, Renew agreement, scope amendment, and history. Preserve the client identity and working roadmap.

Implementation sequence: dated scope and period resolver; transactional agreement migration with audit and permissions; repository API and legacy compatibility; accessible renewal/history flow; workspace, planner and fulfillment integration; database, unit, type and browser verification.

Business dates and old client allocations are entered by staff, never inferred from the example screenshots. Initial agreements can be recorded retrospectively. A confirmed renewal preserves prior scope and work. Existing open work stays under its original agreement unless staff explicitly fund future work under the successor. Core changes are atomic and retries cannot duplicate agreements or obligations.

The feature uses the established workspace's typography, semantic colors and dialog primitives. A guided form reveals the review step after terms are valid. History is an on-demand view; no additional dashboard or visual explainer is added to the application.

Production rollout requires applying the migration before enabling agreement controls. No automatic production backfill or external billing change is part of this implementation.

## Staff workflow

1. Open the existing client workspace. An owner or administrator records verified original terms once: dates, monthly or custom scope, hours treatment, and promised outputs. Existing work is adopted without being recreated. The launch date remains a separate fact.
2. Choose **Renew agreement** when a dated term ends, or **Change scope** to amend an ongoing term. Confirm the new effective date and scope. A scheduled agreement leaves today's terms in effect until its start date.
3. Review unfinished tasks. Selected tasks use the new agreement for effort from its effective date; unselected tasks keep their existing funding agreement. Past work dates, completed outputs, comments, and approvals remain available.
4. Save the review. **Agreement history** shows accepted terms, scope, references, and a saved roadmap/commitment snapshot. The working roadmap stays in place.

An end date includes that final day. The default next start is the following day, but staff must confirm the actual signed dates. A gap is shown as a gap. Monthly hours are calculated for the selected period under the applicable terms and chosen proration policy. Custom hours are a scope total or a planning estimate; they do not become a recurring monthly quota. A custom amendment's hours cover effort from its effective date.

Backdated acceptance can reattribute time and change live report calculations. Published report records are retained; this feature does not add immutable PDF/report versions. Staff should check affected reports after confirming retrospective terms. Already-issued deliverables remain obligations even when a later scope reduces quantity. Custom amendments count earlier issued outputs toward the revised total, including outputs issued between scheduling and activation.

## Rollout

1. Apply `migrations/072_client_agreements.sql` to a staging database containing the existing schema. It is mirrored in `schema.sql` and wrapped in a transaction. Run real Supabase checks for owner/admin acceptance, read-only members, tenant isolation, scheduled activation/cancellation, and deliverable cron generation.
2. Deploy this branch to staging after the migration. Verify the workspace summary and monthly/custom hour views with representative historical records. Database regression tests use a PostgreSQL fixture, not a copy of production.
3. For production, apply migration 072 before deploying the application. If the agreement table is absent, legacy clients continue using existing terms and the new controls stay hidden. Once a client has accepted history, commercial changes and output changes go through the agreement workflow.
4. Pilot with a small set of verified clients. For 12 Volt, confirm the original contract dates and new custom scope before recording the renewal. For Scott Cole, confirm the year, original allocation, and September 1 effective date before recording 20 monthly hours. These examples have not been entered into any real client record.

An incorrect future agreement can be cancelled with its evidence retained. Effective agreements are corrected through a dated amendment; they are not overwritten. If an application rollback is needed, retain the ledger and migration: the old editor cannot safely manage accepted commercial fields. Releasing an older UI after clients begin using the feature requires keeping agreement management available.

External billing, invoice proration, unused-hour rollover, automatic signature verification, client notifications, and new client-portal screens are outside this release. Contract terms determine any transfer or billing action outside the app.

## Verification evidence

The full local suite passes 1,411 tests, including 19 agreement/date/output/SQL cases. Standalone TypeScript checking and the production build pass. Focused lint reports no errors; the full build retains existing repository lint warnings. Tests cover historical allocation, mid-month changes, custom quantities, first-month onboarding attribution, successive renewals, stale reviews, retries, cancellation, permissions, and tenant isolation. Desktop and mobile dialog checks use synthetic records; no live acceptance has been performed. The temporary preview route was removed before release preparation.

The independent finish review returned **ship** for the supplied source and seven screenshots. The documentation handoff confirmed the staff extension follows incumbent styling and preserves the portal-specific `PRODUCT.md`, `DESIGN.md`, and design sidecar. These checks do not certify production data or a live Supabase migration.
