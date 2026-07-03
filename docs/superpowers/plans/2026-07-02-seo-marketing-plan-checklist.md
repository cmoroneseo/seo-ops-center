# SEO Marketing Plan Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Campaign Plan tab on `workspace/[id]` with a single SE Ranking-style checklist called "SEO Marketing Plan" — one plan per client, seeded from a 7-step template, items promotable to real Tasks.

**Architecture:** Two new Postgres tables (`marketing_plans`, `marketing_plan_items`) with standard org RLS. Pure display logic in `lib/marketing-plan-logic.ts` (tested), CRUD in `lib/supabase/marketing-plans.ts` (row-mapper convention), UI in new `components/marketing-plan/` folder. Old `campaign_*` code and tables stay in place, unmounted.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, Supabase, lucide-react, Anthropic SDK (`@anthropic-ai/sdk`), node:test.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-seo-marketing-plan-checklist-design.md`
- Branch: `feat/seo-marketing-plan` (already created). NEVER commit to `main`.
- NEVER add `Co-Authored-By:` or any trailer to commit messages.
- Item status values exactly: `todo` | `done` | `ignored`. Priority: `high` | `medium` | `low`.
- The add-item button is labeled **"Add Item"** (NOT "Add New Task").
- Migration file is `migrations/021_marketing_plans.sql` (020 is taken). Mirror into `schema.sql`.
- Tests run with `node --test <file>` (Node ≥ 23 native TS), same as `lib/seo-ops-logic.test.ts`. NOT vitest.
- Type check before every commit: `npx tsc --noEmit`.
- DB → TS naming: snake_case → camelCase via `rowToX` mappers.
- The migration must be run manually by Carlos in the Supabase Dashboard SQL editor — the implementer only writes the files.

---

### Task 1: Migration 021 + schema.sql mirror

**Files:**
- Create: `migrations/021_marketing_plans.sql`
- Modify: `schema.sql` (append same SQL at end)

**Interfaces:**
- Produces: tables `public.marketing_plans` (unique `client_id`), `public.marketing_plan_items` — column names consumed by Task 4's row mappers.

- [ ] **Step 1: Write the migration file**

Create `migrations/021_marketing_plans.sql`:

```sql
-- =============================================================================
-- 021: SEO Marketing Plan — SE Ranking-style checklist (replaces Campaign Plan UI)
-- =============================================================================
-- One plan per client, seeded from a 7-step template. Items are checklist
-- entries promotable to real tasks via task_id. campaign_* tables are
-- untouched (UI unmounted, data preserved).
-- =============================================================================

create table public.marketing_plans (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null unique,
  title text not null,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index marketing_plans_org_idx on public.marketing_plans (organization_id);

create table public.marketing_plan_items (
  id uuid default uuid_generate_v4() primary key,
  marketing_plan_id uuid references public.marketing_plans(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  step_key text not null,
  title text not null,
  description text,
  status text not null default 'todo'
    check (status in ('todo', 'done', 'ignored')),
  priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low')),
  assignee_id uuid references public.users(id),
  due_date date,
  sort_order smallint not null default 0,
  comments jsonb not null default '[]'::jsonb,
  task_id uuid references public.tasks(id) on delete set null,
  is_custom boolean not null default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index marketing_plan_items_plan_idx on public.marketing_plan_items (marketing_plan_id);

-- Row Level Security
alter table public.marketing_plans       enable row level security;
alter table public.marketing_plan_items  enable row level security;

create policy "Org members can manage marketing_plans"
  on public.marketing_plans for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage marketing_plan_items"
  on public.marketing_plan_items for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );
```

- [ ] **Step 2: Mirror into schema.sql**

Append the exact same SQL (without the header comment block) to the end of `schema.sql`, preceded by a one-line comment `-- 021: marketing plans (SE Ranking-style checklist)`.

- [ ] **Step 3: Verify SQL is syntactically plausible**

Run: `grep -c "create table public.marketing" migrations/021_marketing_plans.sql schema.sql`
Expected: `2` in each file.

- [ ] **Step 4: Commit**

```bash
git add migrations/021_marketing_plans.sql schema.sql
git commit -m "Add marketing_plans and marketing_plan_items tables (migration 021)"
```

---

### Task 2: Types + template content

**Files:**
- Modify: `lib/types.ts` (append at end)
- Create: `lib/marketing-plan-template.ts`

**Interfaces:**
- Produces (in `lib/types.ts`):
  - `type MarketingPlanItemStatus = 'todo' | 'done' | 'ignored'`
  - `type MarketingPlanItemPriority = 'high' | 'medium' | 'low'`
  - `interface MarketingPlanStep { key: string; name: string; sortOrder: number }`
  - `interface MarketingPlanItemComment { authorId?: string; authorName: string; body: string; createdAt: string }`
  - `interface MarketingPlanItem` (full — see code)
  - `interface MarketingPlan` (full — see code)
- Produces (in `lib/marketing-plan-template.ts`):
  - `MARKETING_PLAN_STEPS: MarketingPlanStep[]` (7 steps)
  - `MARKETING_PLAN_TEMPLATE_ITEMS: TemplateItem[]` where `TemplateItem = { stepKey: string; title: string; description: string; priority: MarketingPlanItemPriority }`

- [ ] **Step 1: Add types to lib/types.ts**

Append at the end of `lib/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// SEO Marketing Plan (checklist) — migration 021
// ---------------------------------------------------------------------------

export type MarketingPlanItemStatus = 'todo' | 'done' | 'ignored';
export type MarketingPlanItemPriority = 'high' | 'medium' | 'low';

export interface MarketingPlanStep {
    key: string;
    name: string;
    sortOrder: number;
}

export interface MarketingPlanItemComment {
    authorId?: string;
    authorName: string;
    body: string;
    createdAt: string; // ISO timestamp
}

export interface MarketingPlanItem {
    id: string;
    marketingPlanId: string;
    organizationId: string;
    clientId: string;
    stepKey: string;
    title: string;
    description?: string;
    status: MarketingPlanItemStatus;
    priority: MarketingPlanItemPriority;
    assigneeId?: string;
    dueDate?: string; // YYYY-MM-DD
    sortOrder: number;
    comments: MarketingPlanItemComment[];
    taskId?: string; // set when promoted to a real Task
    isCustom: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface MarketingPlan {
    id: string;
    organizationId: string;
    clientId: string;
    title: string;
    steps: MarketingPlanStep[];
    createdAt: string;
    updatedAt: string;
    items?: MarketingPlanItem[]; // populated by getMarketingPlan
}
```

- [ ] **Step 2: Create the template file**

Create `lib/marketing-plan-template.ts` with the full 7-step, 56-item template. Content is written for Marketing Empire Group's stack (GSC, GA4, Ahrefs, GBP):

```typescript
import { MarketingPlanStep, MarketingPlanItemPriority } from './types';

export interface TemplateItem {
    stepKey: string;
    title: string;
    description: string;
    priority: MarketingPlanItemPriority;
}

export const MARKETING_PLAN_STEPS: MarketingPlanStep[] = [
    { key: 'setup', name: 'Introduction & Setup', sortOrder: 0 },
    { key: 'technical', name: 'Technical SEO', sortOrder: 1 },
    { key: 'research', name: 'Keyword & Competitor Research', sortOrder: 2 },
    { key: 'content', name: 'Content Audit & Creation', sortOrder: 3 },
    { key: 'onpage', name: 'On-page SEO', sortOrder: 4 },
    { key: 'links', name: 'Link Building', sortOrder: 5 },
    { key: 'local', name: 'Local SEO', sortOrder: 6 },
];

export const MARKETING_PLAN_TEMPLATE_ITEMS: TemplateItem[] = [
    // --- Step 1: Introduction & Setup -------------------------------------
    { stepKey: 'setup', priority: 'high', title: 'Confirm website and CMS access',
      description: 'Collect admin credentials for the website/CMS (WordPress, Shopify, etc.) and hosting. Verify we can edit pages, templates, and redirects.' },
    { stepKey: 'setup', priority: 'high', title: 'Connect Google Search Console',
      description: 'Verify the client\'s domain property in GSC and add our agency account. Confirm impressions/clicks data is flowing into the Analytics tab.' },
    { stepKey: 'setup', priority: 'high', title: 'Connect Google Analytics 4',
      description: 'Get admin or editor access to the GA4 property. Confirm the tracking tag fires on all pages and data appears in our nightly sync.' },
    { stepKey: 'setup', priority: 'high', title: 'Verify Google Business Profile access',
      description: 'Request manager access to the client\'s GBP listing(s). Confirm ownership, correct primary category, and that insights are visible.' },
    { stepKey: 'setup', priority: 'medium', title: 'Add client to Ahrefs tracking',
      description: 'Create the Ahrefs project, set target keywords for rank tracking, and run the first Site Audit crawl.' },
    { stepKey: 'setup', priority: 'high', title: 'Confirm conversion events and goals',
      description: 'Agree with the client on what counts as a conversion (calls, forms, purchases, bookings). Verify each event is tracked in GA4.' },
    { stepKey: 'setup', priority: 'low', title: 'Collect brand assets and guidelines',
      description: 'Gather logo files, brand colors, tone-of-voice notes, and any existing style guide for use in content and GBP posts.' },
    { stepKey: 'setup', priority: 'high', title: 'Hold kickoff call and set expectations',
      description: 'Walk the client through the plan, timeline, and communication cadence. Document commitments and open questions.' },

    // --- Step 2: Technical SEO ---------------------------------------------
    { stepKey: 'technical', priority: 'high', title: 'Run full site crawl',
      description: 'Run an Ahrefs Site Audit crawl of the entire site. Export the issues report and log the health score as the baseline.' },
    { stepKey: 'technical', priority: 'high', title: 'Fix crawl errors and broken links',
      description: 'Resolve 4xx/5xx errors, broken internal links, and redirect chains surfaced by the crawl. Re-crawl to confirm.' },
    { stepKey: 'technical', priority: 'high', title: 'Review robots.txt and XML sitemap',
      description: 'Confirm robots.txt isn\'t blocking important sections, the XML sitemap includes all indexable URLs, and it\'s submitted in GSC.' },
    { stepKey: 'technical', priority: 'medium', title: 'Check HTTPS and redirect health',
      description: 'Verify the site forces HTTPS, www/non-www resolves to one canonical host, and no mixed-content warnings exist.' },
    { stepKey: 'technical', priority: 'medium', title: 'Audit Core Web Vitals',
      description: 'Review LCP, INP, and CLS in GSC\'s Core Web Vitals report and PageSpeed Insights. List the top fixes for slow templates.' },
    { stepKey: 'technical', priority: 'medium', title: 'Check mobile usability',
      description: 'Test key templates on mobile. Fix viewport issues, tap-target spacing, and content wider than the screen.' },
    { stepKey: 'technical', priority: 'medium', title: 'Resolve duplicate content and canonicals',
      description: 'Identify duplicate or near-duplicate pages, set canonical tags correctly, and noindex thin utility pages.' },
    { stepKey: 'technical', priority: 'medium', title: 'Review site architecture and crawl depth',
      description: 'Ensure important pages are within 3 clicks of the homepage. Fix orphan pages by adding internal links.' },
    { stepKey: 'technical', priority: 'medium', title: 'Implement baseline schema markup',
      description: 'Add Organization/LocalBusiness schema sitewide plus appropriate types on key templates (Service, FAQ, Breadcrumb). Validate with Google\'s Rich Results test.' },

    // --- Step 3: Keyword & Competitor Research ------------------------------
    { stepKey: 'research', priority: 'high', title: 'Identify seed keywords from services',
      description: 'List every service/product the client offers and turn each into seed keywords, including local modifiers where relevant.' },
    { stepKey: 'research', priority: 'high', title: 'Build the keyword universe in Ahrefs',
      description: 'Expand seeds via Keywords Explorer (matching terms, questions, also-rank-for). Export with volume, difficulty, and intent.' },
    { stepKey: 'research', priority: 'medium', title: 'Map keywords to funnel stages',
      description: 'Tag each keyword as informational, commercial, or transactional so content types can be matched to intent.' },
    { stepKey: 'research', priority: 'high', title: 'Identify top competitors',
      description: 'Pick 3–5 true SERP competitors (who actually ranks for target keywords, not just business rivals).' },
    { stepKey: 'research', priority: 'medium', title: 'Run competitor content gap analysis',
      description: 'Use Ahrefs Content Gap to find keywords competitors rank for that the client doesn\'t. Shortlist high-value gaps.' },
    { stepKey: 'research', priority: 'medium', title: 'Run competitor backlink gap analysis',
      description: 'Compare backlink profiles against competitors in Ahrefs Link Intersect. Save referring domains that link to 2+ competitors.' },
    { stepKey: 'research', priority: 'high', title: 'Prioritize target keywords',
      description: 'Score the shortlist by business value, volume, and difficulty. Pick the primary targets for the first 90 days.' },
    { stepKey: 'research', priority: 'high', title: 'Create the keyword-to-page map',
      description: 'Assign every priority keyword to an existing page or a new page to be created. This map drives the content calendar.' },

    // --- Step 4: Content Audit & Creation -----------------------------------
    { stepKey: 'content', priority: 'medium', title: 'Inventory existing content',
      description: 'Export all indexable URLs with traffic, impressions, and top queries (GSC + GA4). This is the working sheet for the audit.' },
    { stepKey: 'content', priority: 'medium', title: 'Flag thin and outdated content',
      description: 'Mark pages with little traffic, outdated info, or under ~300 words for update, consolidation, or removal.' },
    { stepKey: 'content', priority: 'medium', title: 'Update or consolidate underperformers',
      description: 'Refresh outdated pages, merge overlapping ones with 301s, and prune dead weight. Track changes for before/after reporting.' },
    { stepKey: 'content', priority: 'high', title: 'Build the editorial calendar',
      description: 'Schedule the first 3 months of content from the keyword-to-page map, matched to the client\'s monthly blog commitment.' },
    { stepKey: 'content', priority: 'high', title: 'Improve core service page copy',
      description: 'Rewrite priority service pages: clear H1, benefit-led copy, trust signals, FAQ block, and strong call-to-action.' },
    { stepKey: 'content', priority: 'high', title: 'Publish the first blog batch',
      description: 'Write and publish the first set of blog posts from the calendar, each targeting one mapped keyword cluster.' },
    { stepKey: 'content', priority: 'medium', title: 'Add internal links from new content',
      description: 'Link every new post to its related service page and to 2–3 related posts using descriptive anchor text.' },
    { stepKey: 'content', priority: 'low', title: 'Set the content quality checklist',
      description: 'Document the pre-publish checklist (title tag, meta, headings, internal links, images, schema) so every post ships consistent.' },

    // --- Step 5: On-page SEO -------------------------------------------------
    { stepKey: 'onpage', priority: 'high', title: 'Optimize title tags and meta descriptions',
      description: 'Rewrite titles/metas on priority pages: primary keyword near the front, under pixel limits, compelling click reason.' },
    { stepKey: 'onpage', priority: 'medium', title: 'Audit heading structure',
      description: 'Ensure one H1 per page containing the target keyword, with a logical H2/H3 hierarchy — no skipped levels or styled-only headings.' },
    { stepKey: 'onpage', priority: 'low', title: 'Fix image alt text and compression',
      description: 'Add descriptive alt text to meaningful images and compress oversized files (WebP where possible).' },
    { stepKey: 'onpage', priority: 'medium', title: 'Review URL structure',
      description: 'Confirm URLs are short, keyword-relevant, and lowercase. Only change URLs where the win justifies a 301.' },
    { stepKey: 'onpage', priority: 'medium', title: 'Optimize internal anchor text',
      description: 'Replace generic anchors ("click here") pointing at priority pages with descriptive, keyword-relevant anchors.' },
    { stepKey: 'onpage', priority: 'medium', title: 'Add FAQ sections to key pages',
      description: 'Add 3–6 real customer questions with concise answers to service pages, marked up with FAQ schema.' },
    { stepKey: 'onpage', priority: 'low', title: 'Target featured snippets',
      description: 'Find queries where the client ranks 2–10 and a snippet exists. Restructure answers (definition, list, or table) to win the snippet.' },
    { stepKey: 'onpage', priority: 'high', title: 'Deep-audit the top 10 landing pages',
      description: 'Full on-page pass of the 10 most important pages: intent match, content depth, E-E-A-T signals, CTAs, and page experience.' },

    // --- Step 6: Link Building -----------------------------------------------
    { stepKey: 'links', priority: 'medium', title: 'Audit the baseline backlink profile',
      description: 'Review referring domains, anchor distribution, and authority trend in Ahrefs. Record baseline DR and referring-domain count.' },
    { stepKey: 'links', priority: 'low', title: 'Review for toxic links',
      description: 'Check for spammy link patterns. Only prepare a disavow if there\'s a genuinely manipulative profile — most sites don\'t need one.' },
    { stepKey: 'links', priority: 'medium', title: 'Build the citation and directory foundation',
      description: 'Submit consistent NAP to the core directories and relevant industry/local directories. Log each listing.' },
    { stepKey: 'links', priority: 'medium', title: 'Prospect from competitor link intersect',
      description: 'Work the saved link-intersect list: qualify each referring domain and add outreach-worthy ones to the pipeline.' },
    { stepKey: 'links', priority: 'medium', title: 'Build the outreach list and templates',
      description: 'Assemble target sites with contact info and write personalized outreach templates per link type (guest post, resource, mention).' },
    { stepKey: 'links', priority: 'high', title: 'Earn quality links monthly',
      description: 'Execute outreach with a target of 3–5 quality, relevant links per month. Log each acquired link with date and page.' },
    { stepKey: 'links', priority: 'low', title: 'Monitor new and lost backlinks',
      description: 'Review Ahrefs new/lost backlink alerts monthly. Reclaim valuable lost links and flag suspicious new ones.' },

    // --- Step 7: Local SEO -----------------------------------------------------
    { stepKey: 'local', priority: 'high', title: 'Complete the GBP profile',
      description: 'Fill every GBP field: description, services, hours, attributes, service areas, booking links. Completeness drives ranking.' },
    { stepKey: 'local', priority: 'high', title: 'Review GBP categories and services',
      description: 'Set the most specific primary category and add all relevant secondary categories. Mirror the service list to the website.' },
    { stepKey: 'local', priority: 'medium', title: 'Establish GBP photo and post cadence',
      description: 'Upload quality photos (exterior, interior, team, work examples) and schedule recurring GBP posts (offers, updates, projects).' },
    { stepKey: 'local', priority: 'high', title: 'Launch the review generation strategy',
      description: 'Set up the review ask workflow (post-job SMS/email with direct review link). Target a steady flow of new Google reviews.' },
    { stepKey: 'local', priority: 'medium', title: 'Respond to all reviews',
      description: 'Reply to every review — thank positives, address negatives professionally. Keep response time under one week.' },
    { stepKey: 'local', priority: 'medium', title: 'Audit NAP consistency',
      description: 'Verify name, address, and phone are identical across the website, GBP, and all citations. Fix mismatches.' },
    { stepKey: 'local', priority: 'high', title: 'Build local landing pages',
      description: 'Create a dedicated page per priority service-area/city with unique local content — no doorway-page boilerplate.' },
    { stepKey: 'local', priority: 'medium', title: 'Track local pack rankings',
      description: 'Add priority "service + city" keywords to rank tracking and monitor local pack presence monthly.' },
];
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/marketing-plan-template.ts
git commit -m "Add marketing plan types and 7-step checklist template"
```

---

### Task 3: Pure logic + tests (TDD)

**Files:**
- Create: `lib/marketing-plan-logic.ts`
- Test: `lib/marketing-plan-logic.test.ts`

**Interfaces:**
- Consumes: `MarketingPlanItem`, `MarketingPlanStep` from `lib/types.ts` (Task 2).
- Produces:
  - `interface PlanSummary { total: number; done: number; todo: number; ignored: number; progressPercent: number; priorityCounts: { high: number; medium: number; low: number } }`
  - `computePlanSummary(items: MarketingPlanItem[]): PlanSummary` — `progressPercent = round(done / (total - ignored) * 100)`, 0 when denominator is 0. `priorityCounts` counts only non-ignored items.
  - `type GroupMode = 'step' | 'priority' | 'status'`
  - `groupItems(items: MarketingPlanItem[], steps: MarketingPlanStep[], mode: GroupMode): { key: string; label: string; items: MarketingPlanItem[] }[]` — step mode returns one group per step in `sortOrder` order (including empty steps), items sorted by `sortOrder`; priority mode returns high/medium/low groups; status mode returns To Do/Done/Ignored groups. Priority/status modes omit empty groups.
  - `filterItems(items: MarketingPlanItem[], query: string): MarketingPlanItem[]` — case-insensitive match on title or description; empty/whitespace query returns all items.

- [ ] **Step 1: Write the failing tests**

Create `lib/marketing-plan-logic.test.ts`:

```typescript
/**
 * Run with:  node --test lib/marketing-plan-logic.test.ts
 * (Node >= 23 strips TypeScript types natively — no test framework needed.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlanSummary, groupItems, filterItems } from './marketing-plan-logic';
import { MarketingPlanItem, MarketingPlanStep } from './types';

function item(over: Partial<MarketingPlanItem>): MarketingPlanItem {
    return {
        id: 'i1', marketingPlanId: 'p1', organizationId: 'o1', clientId: 'c1',
        stepKey: 'setup', title: 'Item', status: 'todo', priority: 'medium',
        sortOrder: 0, comments: [], isCustom: false,
        createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z',
        ...over,
    };
}

const STEPS: MarketingPlanStep[] = [
    { key: 'setup', name: 'Introduction & Setup', sortOrder: 0 },
    { key: 'technical', name: 'Technical SEO', sortOrder: 1 },
];

test('computePlanSummary counts statuses and priorities', () => {
    const s = computePlanSummary([
        item({ id: 'a', status: 'done', priority: 'high' }),
        item({ id: 'b', status: 'todo', priority: 'medium' }),
        item({ id: 'c', status: 'todo', priority: 'medium' }),
        item({ id: 'd', status: 'ignored', priority: 'low' }),
    ]);
    assert.equal(s.total, 4);
    assert.equal(s.done, 1);
    assert.equal(s.todo, 2);
    assert.equal(s.ignored, 1);
    // done / (total - ignored) = 1/3 → 33
    assert.equal(s.progressPercent, 33);
    // ignored items excluded from priority counts
    assert.deepEqual(s.priorityCounts, { high: 1, medium: 2, low: 0 });
});

test('computePlanSummary handles empty list', () => {
    const s = computePlanSummary([]);
    assert.equal(s.total, 0);
    assert.equal(s.progressPercent, 0);
});

test('computePlanSummary is 100% when all non-ignored are done', () => {
    const s = computePlanSummary([
        item({ id: 'a', status: 'done' }),
        item({ id: 'b', status: 'ignored' }),
    ]);
    assert.equal(s.progressPercent, 100);
});

test('groupItems by step keeps template order and includes empty steps', () => {
    const groups = groupItems(
        [item({ id: 'a', stepKey: 'technical', sortOrder: 1 }),
         item({ id: 'b', stepKey: 'technical', sortOrder: 0 })],
        STEPS, 'step');
    assert.equal(groups.length, 2);
    assert.equal(groups[0].label, 'Introduction & Setup');
    assert.equal(groups[0].items.length, 0);
    // sorted by sortOrder within group
    assert.deepEqual(groups[1].items.map(i => i.id), ['b', 'a']);
});

test('groupItems by priority omits empty groups, orders high→low', () => {
    const groups = groupItems(
        [item({ id: 'a', priority: 'low' }), item({ id: 'b', priority: 'high' })],
        STEPS, 'priority');
    assert.deepEqual(groups.map(g => g.key), ['high', 'low']);
});

test('groupItems by status orders todo→done→ignored', () => {
    const groups = groupItems(
        [item({ id: 'a', status: 'done' }), item({ id: 'b', status: 'todo' })],
        STEPS, 'status');
    assert.deepEqual(groups.map(g => g.key), ['todo', 'done']);
    assert.equal(groups[0].label, 'To Do');
});

test('filterItems matches title and description, case-insensitive', () => {
    const items = [
        item({ id: 'a', title: 'Connect Google Search Console' }),
        item({ id: 'b', title: 'Other', description: 'verify GSC property' }),
        item({ id: 'c', title: 'Unrelated' }),
    ];
    assert.deepEqual(filterItems(items, 'gsc').map(i => i.id), ['b']);
    assert.deepEqual(filterItems(items, 'google').map(i => i.id), ['a']);
    assert.equal(filterItems(items, '  ').length, 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/marketing-plan-logic.test.ts`
Expected: FAIL — cannot find module `./marketing-plan-logic`.

- [ ] **Step 3: Write the implementation**

Create `lib/marketing-plan-logic.ts`:

```typescript
import {
    MarketingPlanItem, MarketingPlanStep,
    MarketingPlanItemPriority, MarketingPlanItemStatus,
} from './types';

export interface PlanSummary {
    total: number;
    done: number;
    todo: number;
    ignored: number;
    progressPercent: number;
    priorityCounts: { high: number; medium: number; low: number };
}

export function computePlanSummary(items: MarketingPlanItem[]): PlanSummary {
    const total = items.length;
    const done = items.filter(i => i.status === 'done').length;
    const ignored = items.filter(i => i.status === 'ignored').length;
    const todo = total - done - ignored;
    const denominator = total - ignored;
    const progressPercent = denominator === 0 ? 0 : Math.round((done / denominator) * 100);
    const active = items.filter(i => i.status !== 'ignored');
    const priorityCounts = {
        high: active.filter(i => i.priority === 'high').length,
        medium: active.filter(i => i.priority === 'medium').length,
        low: active.filter(i => i.priority === 'low').length,
    };
    return { total, done, todo, ignored, progressPercent, priorityCounts };
}

export type GroupMode = 'step' | 'priority' | 'status';

export interface ItemGroup {
    key: string;
    label: string;
    items: MarketingPlanItem[];
}

const PRIORITY_ORDER: { key: MarketingPlanItemPriority; label: string }[] = [
    { key: 'high', label: 'High' },
    { key: 'medium', label: 'Medium' },
    { key: 'low', label: 'Low' },
];

const STATUS_ORDER: { key: MarketingPlanItemStatus; label: string }[] = [
    { key: 'todo', label: 'To Do' },
    { key: 'done', label: 'Done' },
    { key: 'ignored', label: 'Ignored' },
];

export function groupItems(
    items: MarketingPlanItem[],
    steps: MarketingPlanStep[],
    mode: GroupMode,
): ItemGroup[] {
    const bySort = (a: MarketingPlanItem, b: MarketingPlanItem) => a.sortOrder - b.sortOrder;

    if (mode === 'step') {
        return [...steps]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(s => ({
                key: s.key,
                label: s.name,
                items: items.filter(i => i.stepKey === s.key).sort(bySort),
            }));
    }
    if (mode === 'priority') {
        return PRIORITY_ORDER
            .map(p => ({
                key: p.key,
                label: p.label,
                items: items.filter(i => i.priority === p.key).sort(bySort),
            }))
            .filter(g => g.items.length > 0);
    }
    return STATUS_ORDER
        .map(s => ({
            key: s.key,
            label: s.label,
            items: items.filter(i => i.status === s.key).sort(bySort),
        }))
        .filter(g => g.items.length > 0);
}

export function filterItems(items: MarketingPlanItem[], query: string): MarketingPlanItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q),
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/marketing-plan-logic.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Type check and commit**

```bash
npx tsc --noEmit
git add lib/marketing-plan-logic.ts lib/marketing-plan-logic.test.ts
git commit -m "Add marketing plan summary/grouping/filter logic with tests"
```

---

### Task 4: CRUD layer

**Files:**
- Create: `lib/supabase/marketing-plans.ts`

**Interfaces:**
- Consumes: types from Task 2; template from Task 2; `createTask` from `lib/supabase/tasks.ts` (existing — signature `createTask(t: TaskInsert): Promise<{ success: boolean; data?: Task; error?: string }>` where `TaskInsert` includes `organizationId, clientId, title, description?, priority?, createdBy?, actorName?`).
- Produces:
  - `getMarketingPlan(clientId: string): Promise<MarketingPlan | null>` — plan with `items` populated
  - `createMarketingPlanFromTemplate(input: { organizationId: string; clientId: string; clientName: string }): Promise<{ success: boolean; data?: MarketingPlan; error?: string }>`
  - `updateMarketingPlanItem(itemId: string, patch: { status?, priority?, title?, description?, assigneeId?, dueDate? }): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }>`
  - `addItemComment(itemId: string, existing: MarketingPlanItemComment[], comment: MarketingPlanItemComment): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }>`
  - `addCustomItem(input: { marketingPlanId: string; organizationId: string; clientId: string; stepKey: string; title: string; description?: string; priority?: MarketingPlanItemPriority; sortOrder: number }): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }>`
  - `deleteCustomItem(itemId: string): Promise<{ success: boolean; error?: string }>`
  - `promoteItemToTask(item: MarketingPlanItem, actorName?: string): Promise<{ success: boolean; taskId?: string; error?: string }>`

- [ ] **Step 1: Write the CRUD file**

Create `lib/supabase/marketing-plans.ts`:

```typescript
import { createClient } from './client';
import {
    MarketingPlan, MarketingPlanItem, MarketingPlanItemComment,
    MarketingPlanItemPriority,
} from '../types';
import { MARKETING_PLAN_STEPS, MARKETING_PLAN_TEMPLATE_ITEMS } from '../marketing-plan-template';
import { createTask } from './tasks';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToPlan(r: any): MarketingPlan {
    return {
        id: r.id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        title: r.title,
        steps: r.steps ?? [],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function rowToItem(r: any): MarketingPlanItem {
    return {
        id: r.id,
        marketingPlanId: r.marketing_plan_id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        stepKey: r.step_key,
        title: r.title,
        description: r.description ?? undefined,
        status: r.status,
        priority: r.priority,
        assigneeId: r.assignee_id ?? undefined,
        dueDate: r.due_date ?? undefined,
        sortOrder: r.sort_order ?? 0,
        comments: r.comments ?? [],
        taskId: r.task_id ?? undefined,
        isCustom: r.is_custom ?? false,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export async function getMarketingPlan(clientId: string): Promise<MarketingPlan | null> {
    const supabase = createClient();
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('marketing_plans')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
    if (error) { console.error('getMarketingPlan:', error); return null; }
    if (!data) return null;
    const plan = rowToPlan(data);

    const { data: itemRows, error: itemsError } = await supabase
        .from('marketing_plan_items')
        .select('*')
        .eq('marketing_plan_id', plan.id)
        .order('sort_order', { ascending: true });
    if (itemsError) { console.error('getMarketingPlan items:', itemsError); return plan; }
    return { ...plan, items: (itemRows ?? []).map(rowToItem) };
}

export async function createMarketingPlanFromTemplate(input: {
    organizationId: string;
    clientId: string;
    clientName: string;
}): Promise<{ success: boolean; data?: MarketingPlan; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };

    const { data, error } = await supabase
        .from('marketing_plans')
        .insert({
            organization_id: input.organizationId,
            client_id: input.clientId,
            title: `${input.clientName} — SEO Marketing Plan`,
            steps: MARKETING_PLAN_STEPS,
        })
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    const plan = rowToPlan(data);

    const rows = MARKETING_PLAN_TEMPLATE_ITEMS.map((t, i) => ({
        marketing_plan_id: plan.id,
        organization_id: input.organizationId,
        client_id: input.clientId,
        step_key: t.stepKey,
        title: t.title,
        description: t.description,
        priority: t.priority,
        sort_order: i,
    }));
    const { error: itemsError } = await supabase.from('marketing_plan_items').insert(rows);
    if (itemsError) return { success: false, error: itemsError.message };

    return { success: true, data: plan };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function updateMarketingPlanItem(
    itemId: string,
    patch: {
        status?: string; priority?: string; title?: string;
        description?: string; assigneeId?: string | null; dueDate?: string | null;
    },
): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.priority !== undefined) dbPatch.priority = patch.priority;
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.assigneeId !== undefined) dbPatch.assignee_id = patch.assigneeId;
    if (patch.dueDate !== undefined) dbPatch.due_date = patch.dueDate;
    const { data, error } = await supabase
        .from('marketing_plan_items')
        .update(dbPatch)
        .eq('id', itemId)
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToItem(data) };
}

export async function addItemComment(
    itemId: string,
    existing: MarketingPlanItemComment[],
    comment: MarketingPlanItemComment,
): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { data, error } = await supabase
        .from('marketing_plan_items')
        .update({
            comments: [...existing, comment],
            updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToItem(data) };
}

export async function addCustomItem(input: {
    marketingPlanId: string;
    organizationId: string;
    clientId: string;
    stepKey: string;
    title: string;
    description?: string;
    priority?: MarketingPlanItemPriority;
    sortOrder: number;
}): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { data, error } = await supabase
        .from('marketing_plan_items')
        .insert({
            marketing_plan_id: input.marketingPlanId,
            organization_id: input.organizationId,
            client_id: input.clientId,
            step_key: input.stepKey,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority ?? 'medium',
            sort_order: input.sortOrder,
            is_custom: true,
        })
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToItem(data) };
}

export async function deleteCustomItem(itemId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { error } = await supabase
        .from('marketing_plan_items')
        .delete()
        .eq('id', itemId)
        .eq('is_custom', true);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ---------------------------------------------------------------------------
// Promote to Task
// ---------------------------------------------------------------------------

export async function promoteItemToTask(
    item: MarketingPlanItem,
    actorName?: string,
): Promise<{ success: boolean; taskId?: string; error?: string }> {
    const res = await createTask({
        organizationId: item.organizationId,
        clientId: item.clientId,
        title: item.title,
        description: item.description,
        priority: item.priority,
        assigneeIds: item.assigneeId ? [item.assigneeId] : undefined,
        dueDate: item.dueDate,
        actorName,
    });
    if (!res.success || !res.data) return { success: false, error: res.error ?? 'Task creation failed' };

    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { error } = await supabase
        .from('marketing_plan_items')
        .update({ task_id: res.data.id, updated_at: new Date().toISOString() })
        .eq('id', item.id);
    if (error) return { success: false, error: error.message };
    return { success: true, taskId: res.data.id };
}
```

Note: `TaskPriority` is `'low' | 'medium' | 'high' | 'urgent'` (verified at `lib/types.ts:182`) — our `high|medium|low` is a subset and assigns cleanly. No cast needed.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/marketing-plans.ts
git commit -m "Add marketing plan CRUD layer with promote-to-task"
```

---

### Task 5: Presentational components — SummaryStrip and StepRail

**Files:**
- Create: `components/marketing-plan/SummaryStrip.tsx`
- Create: `components/marketing-plan/StepRail.tsx`

**Interfaces:**
- Consumes: `PlanSummary` from `lib/marketing-plan-logic.ts`; `MarketingPlanStep`, `MarketingPlanItem` from `lib/types.ts`.
- Produces:
  - `<SummaryStrip summary={PlanSummary} />`
  - `<StepRail steps={MarketingPlanStep[]} items={MarketingPlanItem[]} activeStepKey={string | null} onSelect={(key: string) => void} />`

- [ ] **Step 1: Create SummaryStrip**

Create `components/marketing-plan/SummaryStrip.tsx`:

```tsx
'use client';

import { ChevronsUp, Equal, ChevronsDown } from 'lucide-react';
import { PlanSummary } from '@/lib/marketing-plan-logic';

export function SummaryStrip({ summary }: { summary: PlanSummary }) {
    const s = summary;
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 rounded-xl border border-border/50 bg-card divide-y md:divide-y-0 md:divide-x divide-border/50 print:hidden">
            {/* Plan progress */}
            <div className="p-4 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Plan Progress</div>
                <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-primary">{s.done}</span>
                    <span className="text-lg text-muted-foreground">/{s.total}</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${s.progressPercent}%` }}
                        />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{s.progressPercent}%</span>
                </div>
            </div>
            {/* Status counts */}
            <div className="p-4 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</div>
                <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-500" /> To Do</span>
                        <span className="font-semibold">{s.todo}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500" /> Done</span>
                        <span className="font-semibold">{s.done}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gray-400" /> Ignored</span>
                        <span className="font-semibold">{s.ignored}</span>
                    </div>
                </div>
            </div>
            {/* Priority counts */}
            <div className="p-4 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Priority</div>
                <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><ChevronsUp className="h-3.5 w-3.5 text-red-500" /> High</span>
                        <span className="font-semibold">{s.priorityCounts.high}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><Equal className="h-3.5 w-3.5 text-yellow-500" /> Medium</span>
                        <span className="font-semibold">{s.priorityCounts.medium}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><ChevronsDown className="h-3.5 w-3.5 text-blue-500" /> Low</span>
                        <span className="font-semibold">{s.priorityCounts.low}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Create StepRail**

Create `components/marketing-plan/StepRail.tsx`:

```tsx
'use client';

import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarketingPlanStep, MarketingPlanItem } from '@/lib/types';

interface StepRailProps {
    steps: MarketingPlanStep[];
    items: MarketingPlanItem[];
    activeStepKey: string | null;
    onSelect: (key: string) => void;
}

export function StepRail({ steps, items, activeStepKey, onSelect }: StepRailProps) {
    const sorted = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
    return (
        <nav className="sticky top-4 space-y-1 print:hidden">
            {sorted.map((step, idx) => {
                const stepItems = items.filter(i => i.stepKey === step.key && i.status !== 'ignored');
                const done = stepItems.filter(i => i.status === 'done').length;
                const isActive = activeStepKey === step.key;
                return (
                    <button
                        key={step.key}
                        onClick={() => onSelect(step.key)}
                        className={cn(
                            'w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm text-left transition-colors',
                            isActive
                                ? 'bg-primary text-primary-foreground font-semibold'
                                : 'hover:bg-muted text-foreground',
                        )}
                    >
                        <span className="truncate">Step {idx + 1}: {step.name}</span>
                        <span className={cn(
                            'flex items-center gap-1 shrink-0 text-xs',
                            isActive ? 'text-primary-foreground/80' : 'text-muted-foreground',
                        )}>
                            {done}/{stepItems.length}
                            <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}
```

- [ ] **Step 3: Type check and commit**

```bash
npx tsc --noEmit
git add components/marketing-plan/SummaryStrip.tsx components/marketing-plan/StepRail.tsx
git commit -m "Add marketing plan summary strip and step rail components"
```

---

### Task 6: ItemRow component (checkbox, priority, details, comments, overflow menu)

**Files:**
- Create: `components/marketing-plan/ItemRow.tsx`

**Interfaces:**
- Consumes: `MarketingPlanItem`, `MarketingPlanItemComment`, `MarketingPlanItemPriority` from `lib/types.ts`; `updateMarketingPlanItem`, `addItemComment`, `deleteCustomItem`, `promoteItemToTask` from Task 4.
- Produces: `<ItemRow item={MarketingPlanItem} members={MemberOption[]} currentUser={{ id?: string; name: string }} onChanged={() => void} />` where `MemberOption = { userId: string; displayName: string }` (exported from this file).

- [ ] **Step 1: Create ItemRow**

Create `components/marketing-plan/ItemRow.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
    ChevronDown, ChevronUp, MoreVertical, User, Clock,
    MessageSquare, ArrowUpRight, Trash2, EyeOff, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    MarketingPlanItem, MarketingPlanItemPriority,
} from '@/lib/types';
import {
    updateMarketingPlanItem, addItemComment,
    deleteCustomItem, promoteItemToTask,
} from '@/lib/supabase/marketing-plans';

export interface MemberOption {
    userId: string;
    displayName: string;
}

const PRIORITY_STYLES: Record<MarketingPlanItemPriority, string> = {
    high: 'text-red-600',
    medium: 'text-yellow-600',
    low: 'text-blue-600',
};

interface ItemRowProps {
    item: MarketingPlanItem;
    members: MemberOption[];
    currentUser: { id?: string; name: string };
    onChanged: () => void;
}

export function ItemRow({ item, members, currentUser, onChanged }: ItemRowProps) {
    const [expanded, setExpanded] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [commentDraft, setCommentDraft] = useState('');
    const [saving, setSaving] = useState(false);

    const isDone = item.status === 'done';
    const isIgnored = item.status === 'ignored';
    const assignee = members.find(m => m.userId === item.assigneeId);

    const toggleDone = async () => {
        await updateMarketingPlanItem(item.id, { status: isDone ? 'todo' : 'done' });
        onChanged();
    };

    const setPriority = async (p: MarketingPlanItemPriority) => {
        await updateMarketingPlanItem(item.id, { priority: p });
        onChanged();
    };

    const setAssignee = async (userId: string) => {
        await updateMarketingPlanItem(item.id, { assigneeId: userId || null });
        onChanged();
    };

    const setDueDate = async (date: string) => {
        await updateMarketingPlanItem(item.id, { dueDate: date || null });
        onChanged();
    };

    const toggleIgnored = async () => {
        setMenuOpen(false);
        await updateMarketingPlanItem(item.id, { status: isIgnored ? 'todo' : 'ignored' });
        onChanged();
    };

    const handlePromote = async () => {
        setMenuOpen(false);
        const res = await promoteItemToTask(item, currentUser.name);
        if (!res.success) alert(res.error ?? 'Failed to create task');
        onChanged();
    };

    const handleDelete = async () => {
        setMenuOpen(false);
        if (!confirm('Delete this item?')) return;
        await deleteCustomItem(item.id);
        onChanged();
    };

    const submitComment = async () => {
        const body = commentDraft.trim();
        if (!body) return;
        setSaving(true);
        await addItemComment(item.id, item.comments, {
            authorId: currentUser.id,
            authorName: currentUser.name,
            body,
            createdAt: new Date().toISOString(),
        });
        setCommentDraft('');
        setSaving(false);
        onChanged();
    };

    const initials = (name: string) =>
        name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

    return (
        <div className={cn(
            'py-4 border-b border-border/40 last:border-b-0',
            isIgnored && 'opacity-50',
        )}>
            {/* Title row */}
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={isDone}
                    onChange={toggleDone}
                    disabled={isIgnored}
                    className="mt-1 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                    <span className={cn('font-semibold text-sm', isDone && 'line-through text-muted-foreground')}>
                        {item.title}
                    </span>
                    {item.taskId && (
                        <a
                            href={`/tasks?task=${item.taskId}`}
                            className="ml-2 inline-flex items-center gap-0.5 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full align-middle"
                        >
                            Task <ArrowUpRight className="h-2.5 w-2.5" />
                        </a>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0 print:hidden">
                    <select
                        value={item.priority}
                        onChange={e => setPriority(e.target.value as MarketingPlanItemPriority)}
                        className={cn(
                            'text-xs font-medium border border-border rounded-lg px-2 py-1.5 bg-card cursor-pointer',
                            PRIORITY_STYLES[item.priority],
                        )}
                    >
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                    </select>
                    <div className="relative">
                        <button
                            onClick={() => setMenuOpen(o => !o)}
                            className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                        >
                            <MoreVertical className="h-4 w-4" />
                        </button>
                        {menuOpen && (
                            <div className="absolute right-0 mt-1 w-44 rounded-lg border border-border bg-card shadow-lg z-10 py-1 text-sm">
                                {!item.taskId && (
                                    <button onClick={handlePromote} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left">
                                        <ArrowUpRight className="h-3.5 w-3.5" /> Promote to Task
                                    </button>
                                )}
                                <button onClick={toggleIgnored} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left">
                                    {isIgnored ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                    {isIgnored ? 'Restore' : 'Ignore'}
                                </button>
                                {item.isCustom && (
                                    <button onClick={handleDelete} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left text-red-600">
                                        <Trash2 className="h-3.5 w-3.5" /> Delete
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Details toggle + meta chips */}
            <div className="flex items-center justify-between mt-2 ml-7">
                <button
                    onClick={() => setExpanded(e => !e)}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline print:hidden"
                >
                    {expanded ? 'Hide details' : 'Show details'}
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                <div className="flex items-center gap-2 text-xs text-muted-foreground print:hidden">
                    <span className="flex items-center gap-1 border border-dashed border-border rounded-full px-2 py-0.5">
                        <User className="h-3 w-3" /> {assignee?.displayName ?? 'Unassigned'}
                    </span>
                    <span className="flex items-center gap-1 border border-dashed border-border rounded-full px-2 py-0.5">
                        <Clock className="h-3 w-3" /> {item.dueDate ?? 'None'}
                    </span>
                    <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" /> {item.comments.length}
                    </span>
                </div>
            </div>

            {/* Expanded details */}
            {expanded && (
                <div className="ml-7 mt-3 space-y-4">
                    {item.description && (
                        <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                    )}
                    <div className="flex items-center gap-3 print:hidden">
                        <select
                            value={item.assigneeId ?? ''}
                            onChange={e => setAssignee(e.target.value)}
                            className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card"
                        >
                            <option value="">Unassigned</option>
                            {members.map(m => (
                                <option key={m.userId} value={m.userId}>{m.displayName}</option>
                            ))}
                        </select>
                        <input
                            type="date"
                            value={item.dueDate ?? ''}
                            onChange={e => setDueDate(e.target.value)}
                            className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card"
                        />
                    </div>
                    {item.comments.length > 0 && (
                        <div className="space-y-2">
                            {item.comments.map((c, i) => (
                                <div key={i} className="flex items-start gap-2">
                                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                                        {initials(c.authorName)}
                                    </div>
                                    <div className="text-sm">
                                        <span className="font-semibold">{c.authorName}</span>
                                        <span className="text-xs text-muted-foreground ml-2">
                                            {new Date(c.createdAt).toLocaleDateString()}
                                        </span>
                                        <p className="text-muted-foreground">{c.body}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex items-start gap-2 print:hidden">
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                            {initials(currentUser.name)}
                        </div>
                        <div className="flex-1 space-y-2">
                            <input
                                value={commentDraft}
                                onChange={e => setCommentDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') submitComment(); }}
                                placeholder="Add a comment..."
                                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card"
                            />
                            {commentDraft.trim() && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={submitComment}
                                        disabled={saving}
                                        className="text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={() => setCommentDraft('')}
                                        className="text-xs font-medium border border-border rounded-lg px-3 py-1.5"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Type check and commit**

```bash
npx tsc --noEmit
git add components/marketing-plan/ItemRow.tsx
git commit -m "Add marketing plan item row with details, comments, promote-to-task"
```

---

### Task 7: MarketingPlanTab orchestrator + AddItemForm

**Files:**
- Create: `components/marketing-plan/AddItemForm.tsx`
- Create: `components/marketing-plan/MarketingPlanTab.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–6; `getOrganizationMembers` from `lib/supabase/organizations.ts` (returns `(OrganizationMember & { user: User })[]` — check `User` for the display-name field with `grep -n "interface User" -A 10 lib/types.ts` and adapt the mapping in Step 2 accordingly); Supabase auth via `createClient().auth.getUser()`.
- Produces: `<MarketingPlanTab organizationId={string} clientId={string} clientName={string} />` — the export Task 8 mounts in the workspace page.

- [ ] **Step 1: Create AddItemForm**

Create `components/marketing-plan/AddItemForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { MarketingPlanStep, MarketingPlanItemPriority } from '@/lib/types';

interface AddItemFormProps {
    steps: MarketingPlanStep[];
    defaultStepKey?: string;
    onSubmit: (fields: {
        stepKey: string; title: string; description?: string;
        priority: MarketingPlanItemPriority;
    }) => Promise<void>;
    onCancel: () => void;
}

export function AddItemForm({ steps, defaultStepKey, onSubmit, onCancel }: AddItemFormProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [stepKey, setStepKey] = useState(defaultStepKey ?? steps[0]?.key ?? '');
    const [priority, setPriority] = useState<MarketingPlanItemPriority>('medium');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        if (!title.trim()) return;
        setSaving(true);
        await onSubmit({ stepKey, title: title.trim(), description: description.trim() || undefined, priority });
        setSaving(false);
    };

    return (
        <div className="rounded-xl border border-primary/40 bg-card p-4 space-y-3">
            <input
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Item title..."
                className="w-full text-sm font-semibold border border-border rounded-lg px-3 py-2 bg-card"
            />
            <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Description (optional)..."
                rows={2}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card"
            />
            <div className="flex items-center gap-2">
                <select
                    value={stepKey}
                    onChange={e => setStepKey(e.target.value)}
                    className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card"
                >
                    {steps.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
                <select
                    value={priority}
                    onChange={e => setPriority(e.target.value as MarketingPlanItemPriority)}
                    className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card"
                >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                </select>
                <div className="flex-1" />
                <button onClick={onCancel} className="text-xs font-medium border border-border rounded-lg px-3 py-1.5">
                    Cancel
                </button>
                <button
                    onClick={submit}
                    disabled={saving || !title.trim()}
                    className="text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                    Add Item
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Create MarketingPlanTab**

Create `components/marketing-plan/MarketingPlanTab.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { ClipboardList, Plus, Search, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarketingPlan, MarketingPlanItem } from '@/lib/types';
import {
    getMarketingPlan, createMarketingPlanFromTemplate, addCustomItem,
} from '@/lib/supabase/marketing-plans';
import { createClient } from '@/lib/supabase/client';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { logActivity } from '@/lib/supabase/client-activity';
import {
    computePlanSummary, groupItems, filterItems, GroupMode,
} from '@/lib/marketing-plan-logic';
import { SummaryStrip } from './SummaryStrip';
import { StepRail } from './StepRail';
import { ItemRow, MemberOption } from './ItemRow';
import { AddItemForm } from './AddItemForm';

interface MarketingPlanTabProps {
    organizationId: string;
    clientId: string;
    clientName: string;
}

export function MarketingPlanTab({ organizationId, clientId, clientName }: MarketingPlanTabProps) {
    const [plan, setPlan] = useState<MarketingPlan | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [groupMode, setGroupMode] = useState<GroupMode>('step');
    const [query, setQuery] = useState('');
    const [activeStepKey, setActiveStepKey] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [members, setMembers] = useState<MemberOption[]>([]);
    const [currentUser, setCurrentUser] = useState<{ id?: string; name: string }>({ name: 'Team' });

    const loadPlan = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        const p = await getMarketingPlan(clientId);
        setPlan(p);
        setLoading(false);
    }, [clientId]);

    const refresh = useCallback(() => loadPlan(true), [loadPlan]);

    useEffect(() => { loadPlan(); }, [loadPlan]);

    useEffect(() => {
        if (!organizationId) return;
        getOrganizationMembers(organizationId).then(ms => {
            const opts = ms.map(m => ({
                userId: m.userId,
                displayName: m.user?.fullName ?? m.user?.email ?? 'Member',
            }));
            setMembers(opts);
            const supabase = createClient();
            supabase?.auth.getUser().then(({ data }) => {
                const uid = data.user?.id;
                if (!uid) return;
                const me = opts.find(o => o.userId === uid);
                setCurrentUser({ id: uid, name: me?.displayName ?? data.user?.email ?? 'Team' });
            });
        });
    }, [organizationId]);

    const handleCreate = async () => {
        setCreating(true);
        const res = await createMarketingPlanFromTemplate({ organizationId, clientId, clientName });
        if (res.success) {
            logActivity({ clientId, eventType: 'campaign.created', metadata: { source: 'marketing_plan_template' } });
        }
        setCreating(false);
        await loadPlan();
    };

    const handleAddItem = async (fields: {
        stepKey: string; title: string; description?: string;
        priority: 'high' | 'medium' | 'low';
    }) => {
        if (!plan) return;
        const maxSort = Math.max(0, ...(plan.items ?? []).map(i => i.sortOrder));
        await addCustomItem({
            marketingPlanId: plan.id, organizationId, clientId,
            ...fields, sortOrder: maxSort + 1,
        });
        setShowAddForm(false);
        refresh();
    };

    if (loading) {
        return <div className="text-center py-12 text-muted-foreground text-sm italic">Loading marketing plan…</div>;
    }

    // Empty state
    if (!plan) {
        return (
            <div className="text-center py-16 space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <ClipboardList className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">No SEO Marketing Plan Yet</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Create a plan for {clientName} — a 7-step SEO checklist covering setup,
                    technical, research, content, on-page, links, and local.
                </p>
                <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                    <Plus className="h-4 w-4" />
                    {creating ? 'Creating…' : 'Create SEO Marketing Plan'}
                </button>
            </div>
        );
    }

    const items = plan.items ?? [];
    const summary = computePlanSummary(items);
    const visibleItems = filterItems(items, query);
    const groups = groupItems(visibleItems, plan.steps, groupMode)
        .filter(g => groupMode !== 'step' || !activeStepKey || g.key === activeStepKey);

    const GROUP_MODES: { key: GroupMode; label: string }[] = [
        { key: 'step', label: 'By Step' },
        { key: 'priority', label: 'By Priority' },
        { key: 'status', label: 'By Status' },
    ];

    return (
        <div className="space-y-6" id="marketing-plan-root">
            {/* Print rules: hide app chrome when exporting */}
            <style>{`@media print { nav, aside, header, .print\\:hidden { display: none !important; } }`}</style>

            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{plan.title}</h3>
                <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors print:hidden"
                >
                    <Upload className="h-3.5 w-3.5" /> Export
                </button>
            </div>

            <SummaryStrip summary={summary} />

            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
                <StepRail
                    steps={plan.steps}
                    items={items}
                    activeStepKey={activeStepKey}
                    onSelect={key => {
                        setGroupMode('step');
                        setActiveStepKey(prev => prev === key ? null : key);
                    }}
                />

                <div className="space-y-4 min-w-0">
                    {/* Toolbar */}
                    <div className="flex items-center gap-3 flex-wrap print:hidden">
                        <div className="flex items-center gap-1 border-b border-border/50">
                            {GROUP_MODES.map(m => (
                                <button
                                    key={m.key}
                                    onClick={() => { setGroupMode(m.key); setActiveStepKey(null); }}
                                    className={cn(
                                        'px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 -mb-px transition-colors',
                                        groupMode === m.key
                                            ? 'border-primary text-foreground'
                                            : 'border-transparent text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1" />
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <input
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Search by keyword..."
                                className="text-sm border border-border rounded-lg pl-8 pr-3 py-1.5 bg-card w-52"
                            />
                        </div>
                        <button
                            onClick={() => setShowAddForm(f => !f)}
                            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-green-700 transition-colors"
                        >
                            <Plus className="h-4 w-4" /> Add Item
                        </button>
                    </div>

                    {showAddForm && (
                        <AddItemForm
                            steps={plan.steps}
                            defaultStepKey={activeStepKey ?? undefined}
                            onSubmit={handleAddItem}
                            onCancel={() => setShowAddForm(false)}
                        />
                    )}

                    {/* Groups */}
                    {groups.map(group => {
                        const done = group.items.filter(i => i.status === 'done').length;
                        const countable = group.items.filter(i => i.status !== 'ignored').length;
                        return (
                            <section key={group.key} className="rounded-xl border border-border/50 bg-card px-5 py-2">
                                <div className="flex items-center justify-between py-3">
                                    <h4 className="font-bold text-base">{group.label}</h4>
                                    <span className="text-sm text-muted-foreground">
                                        <span className="text-primary font-semibold">{done}</span>/{countable}
                                    </span>
                                </div>
                                {group.items.length === 0 ? (
                                    <p className="text-sm text-muted-foreground italic pb-4">No items.</p>
                                ) : (
                                    group.items.map(item => (
                                        <ItemRow
                                            key={item.id}
                                            item={item}
                                            members={members}
                                            currentUser={currentUser}
                                            onChanged={refresh}
                                        />
                                    ))
                                )}
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
```

Note: field names verified against `lib/types.ts` — `OrganizationMember.userId` and `User.fullName` (there is no `displayName`). The mapping above already uses `m.user?.fullName`.

- [ ] **Step 3: Type check and commit**

```bash
npx tsc --noEmit
git add components/marketing-plan/AddItemForm.tsx components/marketing-plan/MarketingPlanTab.tsx
git commit -m "Add marketing plan tab orchestrator with grouping, search, add item, export"
```

---

### Task 8: Workspace integration

**Files:**
- Modify: `app/(dashboard)/workspace/[id]/page.tsx` (line 32 import; line ~224 tab label; line ~259 mount)

**Interfaces:**
- Consumes: `MarketingPlanTab` from Task 7.

- [ ] **Step 1: Swap the import**

In `app/(dashboard)/workspace/[id]/page.tsx`, replace:

```typescript
import { CampaignPlanTab } from '@/components/campaign/CampaignPlanTab';
```

with:

```typescript
import { MarketingPlanTab } from '@/components/marketing-plan/MarketingPlanTab';
```

- [ ] **Step 2: Rename the tab label**

In the tab button for `campaign` (around line 215–225), replace the label text `Campaign Plan` with `SEO Marketing Plan`. Keep the `Target` icon and the `'campaign'` tab key (renaming the key would touch state types for no user-visible gain).

- [ ] **Step 3: Swap the mounted component**

Replace the block:

```tsx
{activeTab === 'campaign' && (
    <CampaignPlanTab
        organizationId={organization?.id ?? ''}
        clientId={client.id}
        clientName={client.clientName}
    />
)}
```

with:

```tsx
{activeTab === 'campaign' && (
    <MarketingPlanTab
        organizationId={organization?.id ?? ''}
        clientId={client.id}
        clientName={client.clientName}
    />
)}
```

- [ ] **Step 4: Verify nothing else imports CampaignPlanTab**

Run: `grep -rn "CampaignPlanTab" app components --include="*.tsx" | grep -v "components/campaign/"`
Expected: no output (only the campaign folder itself references it).

- [ ] **Step 5: Type check and commit**

```bash
npx tsc --noEmit
git add "app/(dashboard)/workspace/[id]/page.tsx"
git commit -m "Mount SEO Marketing Plan tab in workspace, unmount Campaign Plan UI"
```

---

### Task 9: AI suggest-items route + UI

**Files:**
- Create: `app/api/marketing-plan/suggest-items/route.ts`
- Create: `components/marketing-plan/SuggestItemsPanel.tsx`
- Modify: `components/marketing-plan/MarketingPlanTab.tsx` (add Suggest Items button + panel)

**Interfaces:**
- Consumes: `MARKETING_PLAN_STEPS` shape; `addCustomItem` from Task 4.
- Produces: POST `/api/marketing-plan/suggest-items` accepting `{ clientName: string; existingTitles: string[]; steps: { key: string; name: string }[] }`, returning `{ items: { stepKey: string; title: string; description: string; priority: 'high'|'medium'|'low' }[] }`.

- [ ] **Step 1: Create the API route**

Create `app/api/marketing-plan/suggest-items/route.ts` (same pattern as `app/api/campaign/suggest-keywords/route.ts`, including the `claude-sonnet-4-6` model already used across this codebase):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    const { clientName, existingTitles, steps } = await req.json();

    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are an SEO strategist at an agency. Suggest additional checklist items for a client's SEO marketing plan.

Return valid JSON only — no markdown, no commentary. The JSON must be an array of objects:
[
  {
    "stepKey": "one of the provided step keys",
    "title": "short imperative item title",
    "description": "1-2 sentence description of what to do and why",
    "priority": "high" | "medium" | "low"
  }
]

Guidelines:
- Suggest 5-10 items NOT already covered by the existing item titles
- Make items specific and actionable for an SEO agency (GSC, GA4, Ahrefs, GBP stack)
- Assign each item to the most fitting step key
- Do not duplicate or trivially rephrase existing items`,
      messages: [
        {
          role: 'user',
          content: `Client: ${clientName || 'Unknown'}
Available steps: ${JSON.stringify(steps)}
Existing item titles: ${JSON.stringify(existingTitles)}`,
        },
      ],
    });

    const responseText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return NextResponse.json({ items: parsed });
  } catch (err: any) {
    console.error('suggest-items error:', err);
    return NextResponse.json({ error: err.message ?? 'Suggestion failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create SuggestItemsPanel**

Create `components/marketing-plan/SuggestItemsPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Sparkles, Plus, X } from 'lucide-react';
import { MarketingPlan, MarketingPlanItemPriority } from '@/lib/types';
import { addCustomItem } from '@/lib/supabase/marketing-plans';

interface Suggestion {
    stepKey: string;
    title: string;
    description: string;
    priority: MarketingPlanItemPriority;
}

interface SuggestItemsPanelProps {
    plan: MarketingPlan;
    clientName: string;
    onAdded: () => void;
    onClose: () => void;
}

export function SuggestItemsPanel({ plan, clientName, onAdded, onClose }: SuggestItemsPanelProps) {
    const [loading, setLoading] = useState(false);
    const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchSuggestions = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/marketing-plan/suggest-items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientName,
                    existingTitles: (plan.items ?? []).map(i => i.title),
                    steps: plan.steps.map(s => ({ key: s.key, name: s.name })),
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? 'Request failed');
            setSuggestions(json.items);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const accept = async (s: Suggestion) => {
        const maxSort = Math.max(0, ...(plan.items ?? []).map(i => i.sortOrder));
        await addCustomItem({
            marketingPlanId: plan.id,
            organizationId: plan.organizationId,
            clientId: plan.clientId,
            stepKey: s.stepKey,
            title: s.title,
            description: s.description,
            priority: s.priority,
            sortOrder: maxSort + 1,
        });
        setSuggestions(prev => (prev ?? []).filter(x => x !== s));
        onAdded();
    };

    return (
        <div className="rounded-xl border border-primary/40 bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 font-semibold text-sm">
                    <Sparkles className="h-4 w-4 text-primary" /> AI-Suggested Items
                </h4>
                <button onClick={onClose} className="p-1 rounded hover:bg-muted">
                    <X className="h-4 w-4" />
                </button>
            </div>
            {!suggestions && (
                <button
                    onClick={fetchSuggestions}
                    disabled={loading}
                    className="text-sm font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                    {loading ? 'Thinking…' : 'Suggest Items'}
                </button>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {suggestions && suggestions.length === 0 && (
                <p className="text-sm text-muted-foreground italic">No more suggestions — all added or dismissed.</p>
            )}
            {suggestions?.map((s, i) => {
                const step = plan.steps.find(st => st.key === s.stepKey);
                return (
                    <div key={i} className="flex items-start justify-between gap-3 border border-border/50 rounded-lg p-3">
                        <div className="min-w-0">
                            <div className="text-sm font-semibold">{s.title}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>
                            <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wide">
                                {step?.name ?? s.stepKey} · {s.priority}
                            </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                            <button
                                onClick={() => accept(s)}
                                className="p-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700"
                                title="Add to plan"
                            >
                                <Plus className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={() => setSuggestions(prev => (prev ?? []).filter(x => x !== s))}
                                className="p-1.5 rounded-lg border border-border hover:bg-muted"
                                title="Dismiss"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
```

- [ ] **Step 3: Wire into MarketingPlanTab**

In `components/marketing-plan/MarketingPlanTab.tsx`:

1. Add imports:
```typescript
import { Sparkles } from 'lucide-react'; // add to existing lucide import
import { SuggestItemsPanel } from './SuggestItemsPanel';
```
2. Add state next to `showAddForm`:
```typescript
const [showSuggest, setShowSuggest] = useState(false);
```
3. In the toolbar, immediately before the "Add Item" button, add:
```tsx
<button
    onClick={() => setShowSuggest(s => !s)}
    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
>
    <Sparkles className="h-4 w-4" /> Suggest Items
</button>
```
4. Below the `showAddForm` block, add:
```tsx
{showSuggest && (
    <SuggestItemsPanel
        plan={plan}
        clientName={clientName}
        onAdded={refresh}
        onClose={() => setShowSuggest(false)}
    />
)}
```

- [ ] **Step 4: Type check and commit**

```bash
npx tsc --noEmit
git add app/api/marketing-plan/suggest-items/route.ts components/marketing-plan/SuggestItemsPanel.tsx components/marketing-plan/MarketingPlanTab.tsx
git commit -m "Add AI suggest-items route and panel for marketing plan"
```

---

### Task 10: Final verification + docs

**Files:**
- Modify: `CLAUDE.md` (project file — update "What's shipped" and key-files sections)

- [ ] **Step 1: Run the full check suite**

```bash
npx tsc --noEmit
node --test lib/marketing-plan-logic.test.ts
node --test lib/seo-ops-logic.test.ts
```
Expected: tsc exits 0; all tests pass.

- [ ] **Step 2: Update CLAUDE.md**

In the project `CLAUDE.md`:
- Under "What's shipped", add:

```markdown
- **SEO Marketing Plan** (migration 021, Jul 2026):
  - SE Ranking-style checklist replacing the Campaign Plan UI on workspace/[id]
  - `marketing_plans` (one per client, steps jsonb) + `marketing_plan_items` (status todo/done/ignored, priority, assignee, due date, comments jsonb, task_id FK)
  - 7-step template (~56 items) in `lib/marketing-plan-template.ts`
  - Summary strip, sticky step rail, By Step/Priority/Status grouping, keyword search, Add Item
  - Promote to Task (creates real Task, links via task_id; no completion sync back)
  - Export via window.print(); AI Suggest Items via `/api/marketing-plan/suggest-items`
  - Campaign Plan code (`components/campaign/*`, `campaign_*` tables) unmounted but preserved
```

- Update "Migrations applied to production" to mention 021 once Carlos runs it.
- In "Known bugs" or "Pending work", remove any line that says the campaign plan is the active UI if it conflicts.

- [ ] **Step 3: Commit and hand off**

```bash
git add CLAUDE.md
git commit -m "Document SEO Marketing Plan module in CLAUDE.md"
```

Then tell Carlos:
1. Run `migrations/021_marketing_plans.sql` in the Supabase Dashboard SQL editor (paste the whole file).
2. Review template wording in `lib/marketing-plan-template.ts` and edit freely.
3. After his OK: push branch, open PR to `main`, confirm no pending Codex PRs before merging. Vercel auto-deploys on merge.

---

## Self-Review Notes

- Spec coverage: schema (T1), types+template (T2), logic+tests (T3), CRUD+promote (T4), summary/rail (T5), item row with comments/details (T6), orchestrator/search/grouping/add/export (T7), workspace swap (T8), AI assist (T9), docs/verification (T10). Questionnaire import intentionally absent (out of scope per spec).
- The two flagged verification points (TaskPriority union member names; OrganizationMember/User field names) are called out inline in Tasks 4 and 7 with exact grep commands — implementer must run them before typing blind.
- `logActivity` event type reuses `campaign.created` (existing enum value) rather than inventing a new event type that might violate a CHECK constraint; if `client_activity` has no CHECK on event types, a follow-up can rename it.
