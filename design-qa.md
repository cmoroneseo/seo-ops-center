# Monthly execution design QA — September 22, 2026

final result: passed

Scope: visual implementation of selected concept 3, with existing product tokens and actual sandbox data. This is a local preview; production release is pending migration 059.

## Comparison

Compared the selected reference and desktop screenshot together at 1710 × 930, monthly view with an active selected task. Evidence: `docs/research/seo-marketing-plan-monthly-implementation/desktop.png`. The near-black shell, cyan selection, summary strip, task list and adjacent editor follow the selected concept. Real sandbox data replaces the concept's illustrative tasks and metrics. The existing design tokens determine color and typography. The month control supports explicit navigation. Completion uses the existing task review flow rather than fabricated source/evidence fields.

P2 fixed: excessive vertical spacing pushed save/completion controls below the viewport. Reduced section gaps and editor height; actions now appear in the desktop capture.
P2 fixed: undated completed tasks incorrectly triggered an unfinished-work reminder. Excluded completed tasks; covered by regression test.
P2 fixed: background refresh could replace an unsaved editor draft. Dirty drafts are retained until saved.

## Interaction checks

Chrome, Sandbox (testing), Sandbox Client A only: reopened the existing CMS access task, scheduled it for September 22 with Carlos as owner and 2 hours, then saved 2.5 hours inline. Both row and budget summary updated, with a visible success message. Full plan reflects linked task completion/reopening. Results correctly shows 0 of 1 completed after reopening. Narrow viewport 390 × 844 stacks the editor, and controls remain reachable by keyboard; captures include mobile.png and mobile-details.png.

TypeScript passes. Full suite passed 1,249 tests; focused execution tests passed again after the reminder fix. Migration tests execute the SQL against PGlite and check scoped, idempotent task creation plus schema mirroring.

## Release requirements and limitations

Apply migration 059 before deploying: saving goals and promoting previously unlinked items depend on its goal column and atomic RPC. These new DB actions were verified locally in migration tests, not against production. Existing-task scheduling and inline updates were verified in Chrome. No production deployment or migration was performed.

P3 follow-up: add richer source/evidence integrations as a separate feature when the data model supports them. Existing mobile client header clips some peripheral controls; the new plan editor fits the viewport.

## Selected concept 1 elements incorporated

Added the user-outlined large month heading and segmented logged/planned/available capacity meter while retaining concept 3's task/editor layout. Desktop and 390px screenshots visually checked: `header-capacity-desktop.png` and `header-capacity-mobile.png` in the evidence directory. Planned hours exclude completed tasks and subtract budget-counting time already logged to each open task this month. Actual hours include all confirmed budget-counting client work. Missing time data does not display as zero capacity consumed. TypeScript and four focused execution tests pass, including double-counting and over-capacity cases.

## SEO Plan navigation consolidation

Removed the client-level Tasks tab and renamed the parent to SEO Plan. Monthly plan and All client tasks are nested sections, accessible even before a plan exists. Legacy `?tab=tasks`, the timer's Choose Task action, and nested task links open All client tasks. The original task list/create/detail components remain in use. Basecamp import reuses the original scoped import modal; its Integrations entry point remains available. Chrome verified the task list and authorized sandbox Basecamp project selector. No import was submitted during this navigation check. TypeScript and whitespace checks pass.

## September 29 integration verification

Code integration and automated checks passed. Authenticated visual verification of the integrated version is pending a fresh localhost login; earlier screenshots above describe the September 22 implementation. Migration 061 is required before validating new promotion/linking/goal actions against the target DB. See docs/research/seo-plan-review-2026-09-29/integration.md.
