# Marketing Campaign Feature Plan

Status: Draft for review
Source reviewed: SE Ranking Marketing Plan HTML capture, current SEO Ops Campaign Plan implementation, existing onboarding spec

## Product Direction

Evolve Campaign Plan into a quiet, high-clarity planning and execution workspace for SEO teams. The feature should feel less like a form and more like an operating system for a campaign: the team understands the objective, sees the next best work, knows what is in scope, and can turn strategy into tasks, deliverables, and reporting without re-entering the same thinking elsewhere.

If Apple were designing this for an SEO team, the product would not expose every field equally. It would make the campaign feel obvious: one campaign health surface, one guided creation path, one timeline, one scope model, and a small set of excellent actions.

## What The Attached HTML Shows

The attached file is a Chrome view-source capture, not a rendered product screen. The Marketing Plan UI itself is mounted into `<div id="app">` and loaded through `/frontend-dist/MarketingPlan/...` bundles, so the rendered component tree is not present in the HTML.

Useful signals still present:

- The platform treats Marketing Plan as a dedicated project-level module, not a report sub-section.
- It sits beside core SEO tools like Rankings, Competitors, Website Audit, Backlink Monitor, Keyword Research, and On-Page SEO Checker.
- The feature has export support through `window.appData.has_export_to_rb`.
- The surrounding product language suggests a practical SEO checklist/task orientation: Website Audit, Backlinks, Competitors, Keyword Research, SEO Tasks, and Marketing Plan are all adjacent.
- The concept is closer to a guided campaign activity system than a static strategic document.

Implication for SEO Ops: Campaign Plan should become the connective tissue between diagnosis, scope, execution, and reporting. It should keep the strategic richness already envisioned, but present it through a more usable campaign command center.

## Current SEO Ops Baseline

Existing implementation already includes strong foundations:

- Plan creation from questionnaire import, templates, or blank plan.
- Status flow: draft, internal review, approved, active, archived.
- Goals, KPIs, and expectations.
- SEO overview with AI draft support.
- Website analysis and keyword snapshot sections.
- Key activities, preliminary roadmap, timeline, and task generation from phases.
- Scope Meter with hours, contract term, in-scope activities, and upsell flags.
- Activity logging for important campaign events.

Primary gap:

The current experience reads as a set of expandable sections. The next version should read as a campaign cockpit: summary first, guided next actions, timeline and scope always intelligible, details progressively revealed.

## Design Principles

1. Clarity before completeness.
   Show the campaign answer first: objective, status, scope fit, next milestone, risks, and approval state. Put dense editors behind purposeful actions.

2. Progressive disclosure.
   New users should not face every campaign section at once. Start with guided setup, then reveal planning, scope, and execution depth as needed.

3. One source of truth.
   Goals, KPIs, workstreams, timeline, tasks, deliverables, and reports should reference the same campaign entities.

4. Operational calm.
   Avoid flashy dashboard noise. Use restrained typography, clear hierarchy, soft status color, excellent spacing, and consistent controls.

5. Human review over automation.
   AI can draft and suggest, but approval, assumptions, scope, and expectations need visible human ownership.

## Proposed UX Model

### 1. Campaign Command Center

First screen after a plan exists.

Top area:

- Campaign title and status.
- Primary objective in one sentence.
- Completion state.
- Scope fit: planned hours vs contracted hours.
- Current phase and next milestone.
- Risk count and unresolved assumptions.
- Primary action: Continue setup, Submit for review, Approve, Activate, or Review risks.

Middle area:

- Three-column campaign summary:
  - Outcomes: goals and KPI targets.
  - Work: active workstreams and priority activities.
  - Timeline: current phase, next phase, key dates.

Bottom area:

- Next Best Actions queue:
  - Add missing baseline.
  - Review suggested keyword targets.
  - Resolve over-scope activities.
  - Generate tasks from Phase 1.
  - Approve expectations.

Why this matters:

The team should know within five seconds whether the campaign is ready, risky, or unfinished.

### 2. Guided Campaign Builder

Replace the flat empty state with a short, elegant setup path.

Steps:

1. Import or start
   - Import questionnaire.
   - Choose template.
   - Blank plan.

2. Confirm client context
   - Business objective.
   - Services, locations, competitors.
   - Conversion events.
   - Constraints and risks.

3. Choose campaign model
   - Local SEO.
   - Content-led growth.
   - Technical and growth.
   - Custom.

4. Review generated plan
   - Suggested goals.
   - Suggested KPIs.
   - Suggested workstreams.
   - Suggested phases.
   - Suggested expectations.

5. Create campaign
   - Save as draft.
   - Continue editing from command center.

Apple-style interaction:

Use a focused setup panel with one decision per screen, inline validation, and a final review screen. Avoid long multi-section forms.

### 3. Campaign Map

A visual map of the campaign by workstream.

Each workstream shows:

- Name.
- Priority.
- Owner.
- Health.
- Current state.
- Target state.
- Linked tasks.
- Linked deliverables.
- Dependencies.
- Risks.

Default workstreams:

- Research and strategy.
- Technical SEO.
- On-page optimization.
- Content strategy and production.
- Authority and links.
- Local SEO.
- Analytics and tracking.
- CRO and lead quality.

Recommended visual treatment:

A compact grid or horizontal map, not oversized cards. Each workstream should be scannable, with details opening in a side panel.

### 4. Scope Intelligence

Upgrade Scope Meter into a planning decision surface.

Keep:

- Monthly hours.
- Contract term.
- Activity checklist.
- Upsell opportunities.
- Planned vs available hours.

Add:

- Scope health: Under-planned, Balanced, Tight, Over scope.
- Assumption notes per activity.
- Required vs optional activities.
- Phase allocation: where the hours land over time.
- Suggested corrections:
  - Move activity to upsell.
  - Reduce frequency.
  - Add hours.
  - Defer to later phase.

Important:

This should be framed as feasibility guidance, not a warning-heavy spreadsheet.

### 5. Timeline As Campaign Narrative

The timeline should become the bridge from strategy to work.

Timeline views:

- Phase view: Setup, Research, Foundation, Buildout, Expansion, Review.
- Month view: what is planned for each month.
- Task view: what has been generated and what remains.

Each phase supports:

- Objective.
- Date range.
- Included workstreams.
- Milestones.
- Exit criteria.
- Linked tasks.
- Linked deliverables.
- Expected KPI movement.
- Risk or dependency notes.

Primary actions:

- Generate tasks.
- Generate deliverable commitments.
- Prefill monthly plan.
- Mark phase active.
- Complete phase.

### 6. Goals, KPIs, And Expectations

Keep goals separate from KPIs, but improve the mental model.

Recommended layout:

- Left: business goals.
- Middle: KPI evidence.
- Right: expectations and assumptions.

Each goal should answer:

- What outcome do we want?
- How will we know?
- What workstream supports it?
- What assumption could break it?

Each KPI should include:

- Source.
- Baseline.
- Target or range.
- Target date.
- Confidence.
- Reporting cadence.
- Measurement notes.

Each expectation should include:

- Statement.
- Window.
- Measurement definition.
- Preconditions.
- Exclusions.
- Review checkpoint.
- Escalation rule.
- Approver.

Language rule:

Use Expectations, Targets, or Forecasts. Avoid Guarantees unless the business intentionally creates a legally reviewed guarantee workflow.

### 7. Review And Approval

Add a campaign readiness checklist before internal review.

Required before submission:

- At least one primary business goal.
- At least three KPIs with baseline or baseline-needed state.
- At least one approved expectation.
- Timeline has first phase and review date.
- Scope is not over capacity, or over-scope rationale is documented.
- Risks and dependencies reviewed.

Approval screen:

- Show what changed since last review.
- Show unresolved risks.
- Show scope health.
- Show expectations requiring approval.
- Capture approver and timestamp.

### 8. Handoff Summary

Create an internal summary that can be used in onboarding meetings.

Sections:

- Campaign objective.
- Client context.
- Strategic model.
- Goals and KPIs.
- Workstream plan.
- First 30/60/90 days.
- Scope and assumptions.
- Risks.
- Next actions.

This can become an export later, but MVP should prioritize internal usefulness.

## Information Architecture

Recommended top-level tabs:

1. Overview
   - Command center.
   - Readiness.
   - Next actions.

2. Strategy
   - SEO overview.
   - Goals.
   - KPIs.
   - Expectations.

3. Workstreams
   - Campaign map.
   - Activities.
   - Scope Meter.

4. Timeline
   - Phases.
   - Tasks.
   - Deliverables.
   - Monthly plan generation.

5. Evidence
   - Website analysis.
   - Keyword snapshot.
   - Competitors.
   - Screenshots and source notes.

For MVP, this can be simplified to:

- Overview.
- Plan.
- Timeline.

But the underlying components should be grouped around this future IA.

## Implementation Plan

### Phase 1: Reframe The Existing Experience

- Add Campaign Overview command center above the current editor.
- Replace the current plan header and progress bar with readiness, scope, phase, risk, and next-action summaries.
- Add computed readiness rules.
- Add a Next Best Actions component.
- Keep current section components mostly intact.

### Phase 2: Improve Creation Flow

- Convert the no-plan state into a guided campaign builder.
- Preserve questionnaire import, templates, and blank plan.
- Add final review before campaign creation.
- Seed goals, KPIs, workstreams, phases, expectations, and scope items together.

### Phase 3: Campaign Map And Scope Intelligence

- Restore workstreams as a first-class visual map.
- Link key activities and scope items to workstreams.
- Add scope health states and suggestions.
- Add phase allocation for planned hours.

### Phase 4: Timeline To Execution

- Improve phase cards with linked workstreams, tasks, deliverables, and milestones.
- Generate tasks and deliverable commitments from selected phases.
- Add monthly plan prefill from approved phases.
- Surface phase progress from linked tasks and deliverables.

### Phase 5: Reporting And Review Loop

- Pull goals, KPIs, expectations, and phase progress into reports.
- Add KPI rebaseline workflow with activity log.
- Add expectation risk flags.
- Add campaign change history for approvals.

## MVP Recommendation

Build the Apple-inspired version in this order:

1. Command Center.
2. Readiness Checklist.
3. Next Best Actions.
4. Guided Create Flow.
5. Campaign Map.
6. Scope Intelligence upgrades.
7. Timeline-to-tasks and timeline-to-deliverables improvements.

This lets the existing feature feel dramatically better without forcing a data-model rewrite first.

## Open Questions

- Should Campaign Plan remain internal-only, or should we support a client-facing export later?
- Who can approve expectations and scope exceptions?
- Should over-scope plans be blockable, or only flagged?
- Should every active client require an approved campaign plan?
- Should campaign templates be organization-editable?
- Should keyword snapshot and website analysis be evidence inputs only, or should they actively generate recommended workstreams?

## Success Metrics

- Percentage of active clients with approved campaign plans.
- Median time from client creation to approved campaign.
- Percentage of campaign phases with generated tasks.
- Percentage of planned deliverables completed on time.
- Number of over-scope campaigns caught before activation.
- Reduction in onboarding clarification issues.
- Monthly reports with linked goals, KPIs, and campaign phases.
