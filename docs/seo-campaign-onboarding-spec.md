# SEO Campaign Onboarding Plan Spec

Status: Draft for product review
Source inspiration: SERP Co proposal example reviewed June 22, 2026

## Product Thesis

SEO Ops should turn client onboarding into a structured campaign-planning
workspace. The goal is not to create public proposals. The goal is to help the
internal team translate a new client into clear goals, measurable KPIs,
campaign workstreams, timeline phases, commitments, and expectation boundaries
before recurring delivery begins.

The proposal example works because it gives the client a coherent mental model:
business goals, SEO goals, campaign activities, timeline phases, and performance
expectations are all tied together. SEO Ops can adapt that structure for
internal operations by making it editable, measurable, reusable, and connected
to deliverables, reporting, and client activity.

## Reference Patterns Worth Keeping

The reviewed proposal has five useful patterns:

1. Goals are separated from KPIs.
   Goals are business outcomes such as more leads, more revenue, stronger
   authority, or a larger content library. KPIs are measurable signals such as
   tracked conversions, ranking movement, content shipped, backlinks acquired,
   or page-one keyword percentages.

2. SEO strategy is framed as workstreams.
   The proposal groups activity around authority, relevance, and trust. In SEO
   Ops, these should become configurable workstreams such as Technical SEO,
   Content, Authority/Links, Local SEO, CRO, Analytics, and Strategy.

3. Diagnosis is connected to scope.
   Website analysis, keyword snapshots, competitor review, and technical audit
   findings lead into concrete campaign activities. The app should support
   audit inputs that generate or recommend timeline tasks and commitments.

4. Timeline is phased.
   The example uses Research, Strategy, On-page Optimization, Off-page
   Optimization, and Ongoing Work, then maps those into month ranges. SEO Ops
   should create phase-based onboarding plans that can generate monthly plans,
   tasks, and deliverables.

5. Expectations are explicit.
   The example uses aggressive ranking guarantees. SEO Ops should not hard-code
   guarantees as promises, but it should let teams define expectation ranges,
   assumptions, confidence levels, exclusion criteria, and review checkpoints.

## Feature Overview

Build a new client-level module called Campaign Plan. It should be created
during onboarding and remain available as the internal source of truth for the
campaign.

Primary users:
- Account manager: owns goals, expectations, client context, approvals.
- SEO strategist: owns audit findings, keyword targets, campaign roadmap.
- Content lead: owns content commitments, content types, editorial timeline.
- Link/authority specialist: owns authority targets and link-building scope.
- Leadership/admin: reviews feasibility, risk, and promised outcomes.

Core outcome:
Every active client has a campaign plan that answers:
- What are we trying to achieve?
- How will success be measured?
- Which SEO workstreams matter for this client?
- What happens in the first 30, 60, 90, 180, and 365 days?
- What deliverables and recurring commitments are implied?
- What expectations have we set, and under what assumptions?

## Proposed Workflow

### 1. Campaign Intake

Add a guided onboarding flow after client creation or as a tab in the client
workspace.

Fields:
- Business objective: leads, sales, local visibility, authority, traffic,
  content moat, launch support, reputation, other.
- Target services/products/locations.
- Primary conversion events.
- Current analytics confidence: none, partial, strong.
- Known competitors.
- Target market/geography.
- Client constraints: dev access, content approval speed, compliance, budget,
  seasonality, platform limits.
- Risk notes.

Output:
- `campaign_plan` draft record.
- Suggested audit tasks.
- Suggested baseline metrics to capture.

### 2. Goals and KPIs

Add structured goals that separate business outcomes from SEO measurements.

Goal object:
- Title.
- Outcome category.
- Description.
- Target audience or funnel stage.
- Linked KPIs.
- Owner.
- Priority.
- Status.

KPI object:
- Metric name.
- Source: GSC, GA4, GBP, Ahrefs, manual, internal.
- Baseline value.
- Target value or target range.
- Target date.
- Reporting cadence.
- Confidence level.
- Measurement notes.

Recommended default KPI groups:
- Visibility: impressions, average position, ranking distribution, share of
  target keyword set.
- Traffic: organic sessions, clicks, landing-page traffic.
- Conversion: leads, calls, form fills, bookings, assisted conversions.
- Authority: referring domains, quality links, domain/page authority proxy.
- Content: briefs completed, pages published, refreshes shipped.
- Technical: issues resolved, index coverage, CWV status, crawl blockers.

### 3. Workstream Map

Create a visual map of the campaign by workstream. This can be simple in the
MVP: cards with status, priority, health, owners, and linked tasks.

Default workstreams:
- Research and strategy.
- Technical SEO.
- On-page optimization.
- Content strategy and production.
- Authority/link building.
- Local SEO, when applicable.
- Analytics and tracking.
- CRO/lead quality, when applicable.

Each workstream should include:
- Current state.
- Target state.
- Key activities.
- Deliverable commitments.
- Dependencies.
- Risks.
- Review cadence.

### 4. Timeline Builder

Add a timeline that turns strategy into phases.

Default phases:
- Phase 0: Setup and baseline, week 0-2.
- Phase 1: Research, audit, and strategy, month 0-1.
- Phase 2: Foundation fixes and quick wins, month 1-3.
- Phase 3: Content and authority buildout, month 3-6.
- Phase 4: Expansion and optimization, month 6-12.
- Phase 5: Ongoing quarterly reassessment.

Each phase should support:
- Date range.
- Objective.
- Workstreams included.
- Milestones.
- Linked tasks.
- Linked deliverable commitments.
- Exit criteria.
- Internal notes.

The timeline should be able to generate:
- Tasks in the Tasks module.
- Deliverables in the Deliverables module.
- Monthly plan rows in `monthly_plans`.
- Client activity entries for major plan approvals or changes.

### 5. Expectations and Assumptions

Replace public guarantee language with operational expectation management.

Expectation object:
- Type: ranking, traffic, conversion, content, technical, authority, local.
- Claim or expectation.
- Target window: 90 days, 180 days, 365 days, custom.
- Measurement definition.
- Confidence: low, medium, high.
- Preconditions.
- Exclusions.
- Review checkpoint.
- Escalation rule.
- Approved by.

Example:
- Expectation: Improve rankings for priority bottom-funnel keyword set.
- Window: 180 days.
- Measurement: percentage of tracked keyword set reaching top 10/top 20.
- Preconditions: tracking configured, client approves content within 5
  business days, implementation access is available.
- Escalation: if fewer than 30% of planned tasks are shipped by day 60, flag
  expectation at risk.

Important product decision:
Do not call this feature Guarantees in the internal app unless the business
intentionally wants guarantee workflows. Use Expectations, Forecasts, or
Performance Targets.

## MVP Scope

MVP should be focused on planning quality and operational handoff.

Include:
- Campaign Plan tab inside the client workspace.
- Guided campaign intake form.
- Goals and KPI editor.
- Workstream map with default SEO workstreams.
- Timeline builder with default phase template.
- Expectation/assumption editor.
- Generate tasks and deliverable commitments from selected phases.
- Activity log entries when campaign plan is created, approved, or materially
  changed.
- Exportable internal summary for onboarding review.

Do not include in MVP:
- Public proposal builder.
- Client e-signature.
- Automated ranking guarantees.
- AI-authored strategy without review.
- Complex forecasting models.
- Billing or contract enforcement.

## Suggested Data Model

Reuse existing `clients`, `deliverable_commitments`, `deliverables`,
`monthly_plans`, `client_activity`, `client_metrics`, and `reports` concepts.

New tables:

### `campaign_plans`

One active campaign plan per client, with historical versions allowed later.

Fields:
- `id`
- `organization_id`
- `client_id`
- `status`: draft, internal_review, approved, active, archived
- `title`
- `summary`
- `strategy_model`: ART, custom, local, ecommerce, saas, other
- `start_date`
- `target_review_date`
- `created_by_id`
- `approved_by_id`
- `approved_at`
- `custom_fields jsonb`
- `created_at`
- `updated_at`

### `campaign_goals`

Fields:
- `id`
- `campaign_plan_id`
- `organization_id`
- `client_id`
- `title`
- `category`
- `description`
- `priority`
- `owner_id`
- `status`
- `created_at`
- `updated_at`

### `campaign_kpis`

Fields:
- `id`
- `campaign_goal_id`
- `campaign_plan_id`
- `organization_id`
- `client_id`
- `metric_name`
- `source`
- `baseline_value`
- `target_value`
- `target_range_min`
- `target_range_max`
- `target_date`
- `cadence`
- `confidence`
- `measurement_notes`
- `created_at`
- `updated_at`

### `campaign_workstreams`

Fields:
- `id`
- `campaign_plan_id`
- `organization_id`
- `client_id`
- `name`
- `category`
- `status`
- `priority`
- `owner_id`
- `current_state`
- `target_state`
- `risks`
- `custom_fields jsonb`
- `created_at`
- `updated_at`

### `campaign_phases`

Fields:
- `id`
- `campaign_plan_id`
- `organization_id`
- `client_id`
- `name`
- `phase_order`
- `start_date`
- `end_date`
- `objective`
- `exit_criteria`
- `status`
- `created_at`
- `updated_at`

### `campaign_expectations`

Fields:
- `id`
- `campaign_plan_id`
- `organization_id`
- `client_id`
- `type`
- `statement`
- `target_window_days`
- `measurement_definition`
- `confidence`
- `preconditions`
- `exclusions`
- `review_checkpoint_date`
- `escalation_rule`
- `approved_by_id`
- `approved_at`
- `created_at`
- `updated_at`

### Join Tables

- `campaign_phase_workstreams`
- `campaign_phase_tasks`
- `campaign_phase_commitments`
- `campaign_expectation_kpis`

## UX Concept

Client workspace tab: Campaign Plan

Recommended sections:
- Plan Overview: status, start date, review date, owner, approval state.
- Goals and KPIs: business outcomes on the left, measurable KPIs on the right.
- Workstream Map: SEO workstreams, health, priority, owners, key activities.
- Timeline: phase view with milestones and generated tasks.
- Expectations: target windows, assumptions, risk flags, review checkpoints.
- Handoff Summary: generated internal summary for onboarding meeting.

Useful actions:
- Create from template.
- Add goal.
- Add KPI.
- Add phase.
- Generate tasks from phase.
- Generate commitments from phase.
- Send to internal review.
- Approve plan.
- Mark expectation at risk.
- Rebaseline KPI.

## Templates

Start with three templates:

1. Local SEO Retainer
   Workstreams: GBP, citations, local pages, reviews, tracking, content.

2. Content-Led SEO Retainer
   Workstreams: content strategy, briefs, publishing, internal links,
   authority, analytics.

3. Technical + Growth Campaign
   Workstreams: technical audit, on-page optimization, keyword targeting,
   content refresh, authority, CRO.

Templates should create:
- Default workstreams.
- Default phases.
- Suggested KPIs.
- Suggested deliverable commitments.
- Suggested kickoff tasks.

## Integration With Existing App

Deliverables:
- Campaign phases can create `deliverable_commitments`.
- Generated deliverables should retain `commitment_id`.
- Existing fulfillment logic can show whether planned campaign work is being
  shipped.

Tasks:
- Timeline milestones should generate tasks with phase and workstream metadata.
- Tasks should be linked back to the campaign phase.

Monthly plans:
- Approved phases can prefill `monthly_plans.weeks[].planned`.
- Logged hours remain sourced from `time_logs`.

Reports:
- Reports should pull active goals, KPIs, and expectations to create a stronger
  monthly narrative.
- If a KPI is below pace, the report can reference the linked phase,
  dependency, or expectation risk.

Client activity:
- Log campaign plan creation, approval, phase status changes, expectation
  changes, and KPI rebaselines.

## Product Risks

- Guarantee language can create legal or client expectation risk. Keep the app
  language operational unless leadership explicitly approves a guarantee mode.
- Too much structure can slow onboarding. Use templates and progressive detail.
- KPI targets can become false precision. Support ranges, confidence, and
  assumptions.
- Teams may create plans and ignore them. Tie phases to tasks, deliverables,
  reports, and activity logs so the plan stays alive.
- AI-generated recommendations must be reviewable and traceable to inputs.

## Implementation Plan

### Phase 1: Product Skeleton

- Add data tables for campaign plans, goals, KPIs, workstreams, phases, and
  expectations.
- Add RLS policies matching the client-level org membership model.
- Add Campaign Plan tab to client workspace.
- Add create-from-template flow.
- Add basic CRUD for goals, KPIs, workstreams, phases, and expectations.

### Phase 2: Operational Handoff

- Add task generation from phases.
- Add deliverable commitment generation from phases.
- Add client activity logging.
- Add internal review and approval states.
- Add onboarding summary export.

### Phase 3: Reporting and Health

- Surface goal/KPI progress in monthly reports.
- Add expectation health flags.
- Add phase progress based on linked tasks and deliverables.
- Add rebaseline workflow with audit trail.

### Phase 4: Intelligence

- Recommend workstreams based on intake, audit findings, and connected metrics.
- Suggest KPI baselines from GA4/GSC/Ahrefs/GBP integrations.
- Suggest timeline templates based on client type, tier, and constraints.
- Add strategy QA checks before approval.

## Open Decisions

- Should every client require an approved campaign plan before becoming active?
- Should campaign plans support multiple active tracks, such as Technical SEO
  plus Local SEO, or one unified plan per client?
- Should external/client-facing exports be allowed, or should this stay
  internal-only for now?
- Which roles can approve expectations and rebaseline KPIs?
- Should templates be global, organization-specific, or both?

## Success Metrics

- Percentage of new active clients with approved campaign plans.
- Median time from client creation to approved plan.
- Percentage of generated phase tasks completed on time.
- Percentage of deliverable commitments created from campaign plans.
- Reduction in onboarding ambiguity escalations.
- Higher monthly report quality, measured by fewer manually written status
  explanations and clearer KPI-to-workstream attribution.
