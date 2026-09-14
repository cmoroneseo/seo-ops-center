# Attribution Phase 1 (Core MVP) — Implementation Plan

> **Hardening amendment (2026-09-13):** Production implementation uses database-enforced canary organization gating, idempotent client event IDs, distributed per-IP and per-site minute/hour/day quotas, site-scoped HMAC identifiers, Google-organic-only GSC matching, strict HDYHAU field names, permanent-rejection retry shutdown, consent guidance, and “estimated attributed pipeline” language. Earlier illustrative snippets below are historical task scaffolding and may not reflect these final safeguards.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the end-to-end attribution loop — a tracking script installed on client websites captures visits by source, form submissions, and tel clicks; a collection endpoint ingests events into Supabase; a daily cron cross-references conversions with GSC query data; and a workspace Attribution tab displays source breakdowns, conversion logs with likely queries, and an ROI card.

**Architecture:** Lightweight JS tracking script (~5KB) → POST to `/api/attribution/collect` → `attribution_events` + `attribution_conversions` tables in Supabase → daily GSC cross-reference cron populates `likely_queries` → workspace Attribution tab reads conversions and renders dashboard components (donut chart, timeline, conversion log, landing page perf, ROI card). The script uses `sessionStorage` (not cookies) for session continuity. Revenue is computed on read from `clients.avg_deal_value`.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Supabase (Postgres + RLS), Vercel Cron, recharts (charts), `node:test` (unit tests). The tracking script is plain JS with no dependencies.

## Global Constraints

- DB columns: snake_case. TS types: camelCase. Row mapper functions (`rowToX`/`xToRow`) bridge them.
- RLS: all tables use `organization_id IN (SELECT get_user_org_ids())`.
- Tests: `node --test lib/<path>.test.ts` — uses `node:test` + `node:assert/strict`, NOT vitest.
- Migrations: numbered `migrations/056_attribution.sql`, mirrored into `schema.sql`.
- Cron auth: `Authorization: Bearer <CRON_SECRET>` OR logged-in Supabase session. Use `createAdminClient()` for service-role writes.
- No co-author lines in commits.
- Run `npx tsc --noEmit` before pushing.
- Next migration number: **056**.

---

### Task 1: Types & Source Classifier (pure logic)

**Files:**
- Modify: `lib/types.ts` (append new types)
- Create: `lib/attribution/source-classifier.ts`
- Create: `lib/attribution/source-classifier.test.ts`

**Interfaces:**
- Produces: `AttributionSite`, `AttributionEvent`, `AttributionConversion`, `SourceCategory`, `ScriptConfig` types. `classifySource(referrer: string, utmMedium: string | null, siteDomain: string): SourceCategory` function.

- [ ] **Step 1: Write the failing tests for source classifier**

```ts
// lib/attribution/source-classifier.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySource } from './source-classifier.ts';

test('classifySource: google.com → organic_google', () => {
    assert.equal(classifySource('https://www.google.com/', null, 'client.com'), 'organic_google');
});

test('classifySource: google.co.uk → organic_google', () => {
    assert.equal(classifySource('https://www.google.co.uk/search?q=test', null, 'client.com'), 'organic_google');
});

test('classifySource: bing.com → organic_bing', () => {
    assert.equal(classifySource('https://www.bing.com/search?q=test', null, 'client.com'), 'organic_bing');
});

test('classifySource: duckduckgo.com → organic_other', () => {
    assert.equal(classifySource('https://duckduckgo.com/?q=test', null, 'client.com'), 'organic_other');
});

test('classifySource: yahoo.com → organic_other', () => {
    assert.equal(classifySource('https://search.yahoo.com/search?p=test', null, 'client.com'), 'organic_other');
});

test('classifySource: chatgpt.com → ai_chatgpt', () => {
    assert.equal(classifySource('https://chatgpt.com/', null, 'client.com'), 'ai_chatgpt');
});

test('classifySource: chat.openai.com → ai_chatgpt', () => {
    assert.equal(classifySource('https://chat.openai.com/', null, 'client.com'), 'ai_chatgpt');
});

test('classifySource: perplexity.ai → ai_perplexity', () => {
    assert.equal(classifySource('https://www.perplexity.ai/', null, 'client.com'), 'ai_perplexity');
});

test('classifySource: facebook.com → social', () => {
    assert.equal(classifySource('https://www.facebook.com/post/123', null, 'client.com'), 'social');
});

test('classifySource: instagram.com → social', () => {
    assert.equal(classifySource('https://www.instagram.com/', null, 'client.com'), 'social');
});

test('classifySource: linkedin.com → social', () => {
    assert.equal(classifySource('https://www.linkedin.com/', null, 'client.com'), 'social');
});

test('classifySource: x.com → social', () => {
    assert.equal(classifySource('https://x.com/', null, 'client.com'), 'social');
});

test('classifySource: tiktok.com → social', () => {
    assert.equal(classifySource('https://www.tiktok.com/', null, 'client.com'), 'social');
});

test('classifySource: utm_medium=cpc → paid', () => {
    assert.equal(classifySource('https://www.google.com/', 'cpc', 'client.com'), 'paid');
});

test('classifySource: utm_medium=ppc → paid', () => {
    assert.equal(classifySource('https://www.google.com/', 'ppc', 'client.com'), 'paid');
});

test('classifySource: same domain → same_site', () => {
    assert.equal(classifySource('https://www.client.com/about', null, 'client.com'), 'same_site');
});

test('classifySource: no referrer → direct', () => {
    assert.equal(classifySource('', null, 'client.com'), 'direct');
});

test('classifySource: unknown site → referral', () => {
    assert.equal(classifySource('https://www.somesite.com/', null, 'client.com'), 'referral');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test lib/attribution/source-classifier.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement source classifier**

```ts
// lib/attribution/source-classifier.ts

export type SourceCategory =
    | 'organic_google'
    | 'organic_bing'
    | 'organic_other'
    | 'ai_chatgpt'
    | 'ai_perplexity'
    | 'ai_google_aio'
    | 'social'
    | 'paid'
    | 'direct'
    | 'referral'
    | 'same_site';

const SOCIAL_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'pinterest.com', 'reddit.com', 'threads.net'];

function extractDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

export function classifySource(
    referrer: string,
    utmMedium: string | null,
    siteDomain: string,
): SourceCategory {
    if (utmMedium && ['cpc', 'ppc'].includes(utmMedium.toLowerCase())) return 'paid';

    if (!referrer) return 'direct';

    const domain = extractDomain(referrer);
    if (!domain) return 'direct';

    const normalizedSite = siteDomain.replace(/^www\./, '');
    if (domain === normalizedSite || domain.endsWith('.' + normalizedSite)) return 'same_site';

    if (domain === 'chatgpt.com' || domain === 'chat.openai.com') return 'ai_chatgpt';
    if (domain === 'perplexity.ai' || domain.endsWith('.perplexity.ai')) return 'ai_perplexity';

    if (domain.match(/^google\./i) || domain.match(/\.google\./i) || domain.match(/\.google$/i)) return 'organic_google';
    if (domain === 'bing.com' || domain.endsWith('.bing.com')) return 'organic_bing';

    const searchEngines = ['yahoo.com', 'search.yahoo.com', 'duckduckgo.com', 'ecosia.org', 'baidu.com', 'yandex.com', 'yandex.ru'];
    if (searchEngines.some(se => domain === se || domain.endsWith('.' + se))) return 'organic_other';

    if (SOCIAL_DOMAINS.some(sd => domain === sd || domain.endsWith('.' + sd))) return 'social';

    return 'referral';
}
```

- [ ] **Step 4: Add types to `lib/types.ts`**

Append to the end of `lib/types.ts`:

```ts
// --- Attribution ---

export type SourceCategory = 'organic_google' | 'organic_bing' | 'organic_other' | 'ai_chatgpt' | 'ai_perplexity' | 'ai_google_aio' | 'social' | 'paid' | 'direct' | 'referral' | 'same_site';
export type AttributionEventType = 'pageview' | 'form_submit' | 'tel_click';
export type ConversionType = 'form' | 'phone' | 'chat';

export interface ScriptConfig {
    hdyhau_inject: boolean;
    hdyhau_field_patterns: string[];
    track_tel_clicks: boolean;
}

export interface AttributionSite {
    id: string;
    organizationId: string;
    clientId: string;
    domain: string;
    scriptConfig: ScriptConfig;
    isActive: boolean;
    verifiedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface AttributionEvent {
    id: string;
    organizationId: string;
    siteId: string;
    eventType: AttributionEventType;
    sessionId: string;
    visitorId: string;
    sourceCategory: SourceCategory;
    referrerDomain?: string;
    landingPage: string;
    pageUrl: string;
    hdyhauResponse?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    countryCode?: string;
    deviceType?: string;
    createdAt: string;
}

export interface LikelyQuery {
    query: string;
    clicks: number;
    confidence: number;
}

export interface AttributionConversion {
    id: string;
    organizationId: string;
    siteId: string;
    clientId: string;
    eventId: string;
    conversionType: ConversionType;
    sourceCategory: SourceCategory;
    landingPage: string;
    pageUrl: string;
    likelyQueries: LikelyQuery[];
    hdyhauResponse?: string;
    month: string;
    createdAt: string;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test lib/attribution/source-classifier.test.ts
```

Expected: 18 tests, all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/attribution/source-classifier.ts lib/attribution/source-classifier.test.ts
git commit -m "feat(attribution): add types and source classifier with tests"
```

---

### Task 2: Migration & Schema

**Files:**
- Create: `migrations/056_attribution.sql`
- Modify: `schema.sql` (append new tables)

**Interfaces:**
- Produces: `attribution_sites`, `attribution_events`, `attribution_conversions` tables + `avg_deal_value` column on `clients`.

- [ ] **Step 1: Write migration SQL**

```sql
-- migrations/056_attribution.sql
-- Attribution tracking: sites, events, conversions

-- 1. Add avg_deal_value to clients
alter table public.clients
  add column if not exists avg_deal_value numeric;

-- 2. Attribution sites (one per tracked client website)
create table public.attribution_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  domain text not null check (length(domain) > 0),
  script_config jsonb not null default '{"hdyhau_inject": false, "hdyhau_field_patterns": [], "track_tel_clicks": true}'::jsonb,
  is_active boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id)
);

create index attribution_sites_org_idx on public.attribution_sites(organization_id);

alter table public.attribution_sites enable row level security;

create policy "Org members can manage attribution_sites"
  on public.attribution_sites for all
  using      (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

-- 3. Attribution events (high volume, 90-day retention on pageviews)
create table public.attribution_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  site_id uuid not null references public.attribution_sites(id) on delete cascade,
  event_type text not null check (event_type in ('pageview', 'form_submit', 'tel_click')),
  session_id text not null,
  visitor_id text not null,
  source_category text not null,
  referrer_domain text,
  landing_page text not null default '',
  page_url text not null,
  hdyhau_response text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  country_code text,
  device_type text,
  created_at timestamptz not null default now()
);

create index attribution_events_site_created_idx on public.attribution_events(site_id, created_at);
create index attribution_events_site_type_created_idx on public.attribution_events(site_id, event_type, created_at);
create index attribution_events_org_idx on public.attribution_events(organization_id);

alter table public.attribution_events enable row level security;

create policy "Org members can read attribution_events"
  on public.attribution_events for select
  using (organization_id in (select get_user_org_ids()));

-- Service role inserts (events come from the unauthenticated collection endpoint)
create policy "Service role can insert attribution_events"
  on public.attribution_events for insert
  with check (true);

-- 4. Attribution conversions (permanent records)
create table public.attribution_conversions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  site_id uuid not null references public.attribution_sites(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  event_id uuid not null references public.attribution_events(id) on delete cascade,
  conversion_type text not null check (conversion_type in ('form', 'phone', 'chat')),
  source_category text not null,
  landing_page text not null default '',
  page_url text not null,
  likely_queries jsonb,
  hdyhau_response text,
  month date not null,
  created_at timestamptz not null default now()
);

create index attribution_conversions_client_month_idx on public.attribution_conversions(client_id, month);
create index attribution_conversions_site_created_idx on public.attribution_conversions(site_id, created_at);
create index attribution_conversions_org_idx on public.attribution_conversions(organization_id);

alter table public.attribution_conversions enable row level security;

create policy "Org members can read attribution_conversions"
  on public.attribution_conversions for select
  using (organization_id in (select get_user_org_ids()));

create policy "Service role can insert attribution_conversions"
  on public.attribution_conversions for insert
  with check (true);

create policy "Service role can update attribution_conversions"
  on public.attribution_conversions for update
  using (true)
  with check (true);
```

- [ ] **Step 2: Mirror into schema.sql**

Append the same table definitions and policies to the end of `schema.sql`, inside a comment block:

```sql
-- =====================================================================
-- 056 — Attribution tracking
-- =====================================================================
```

- [ ] **Step 3: Update `ClientProject` type and row mapper**

In `lib/types.ts`, add `avgDealValue?: number;` to the `ClientProject` interface (after `seoHours`).

In `lib/supabase/clients.ts`, add `avgDealValue: row.avg_deal_value != null ? Number(row.avg_deal_value) : undefined,` to `rowToClientProject`.

- [ ] **Step 4: Commit**

```bash
git add migrations/056_attribution.sql schema.sql lib/types.ts lib/supabase/clients.ts
git commit -m "feat(attribution): add migration 056 — sites, events, conversions tables"
```

---

### Task 3: Attribution CRUD & Row Mappers

**Files:**
- Create: `lib/supabase/attribution.ts`
- Create: `lib/attribution/query-matcher.ts`
- Create: `lib/attribution/query-matcher.test.ts`

**Interfaces:**
- Consumes: `AttributionSite`, `AttributionEvent`, `AttributionConversion`, `LikelyQuery` from `lib/types.ts`. `createAdminClient()` from `lib/supabase/admin.ts`.
- Produces: `getAttributionSite(clientId): Promise<AttributionSite | null>`, `createAttributionSite(params): Promise<AttributionSite>`, `updateAttributionSite(id, params): Promise<AttributionSite>`, `insertEvents(rows): Promise<void>`, `insertConversion(row): Promise<string>`, `getConversions(clientId, opts): Promise<AttributionConversion[]>`, `getConversionsMissingQueries(lookbackDays): Promise<{id, clientId, landingPage, month}[]>`, `updateConversionQueries(id, queries): Promise<void>`, `deleteOldPageviews(retentionDays): Promise<number>`. `matchQueries(clientId, landingPage, month): Promise<LikelyQuery[]>`.

- [ ] **Step 1: Write the failing tests for query matcher**

```ts
// lib/attribution/query-matcher.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankQueries } from './query-matcher.ts';

test('rankQueries: returns top 3 by clicks', () => {
    const facts = [
        { query: 'plumber dallas', page: '/services', clicks: 50, impressions: 200 },
        { query: 'plumbing company', page: '/services', clicks: 30, impressions: 100 },
        { query: 'emergency plumber', page: '/services', clicks: 20, impressions: 80 },
        { query: 'drain repair', page: '/services', clicks: 5, impressions: 40 },
    ];
    const result = rankQueries(facts, '/services');
    assert.equal(result.length, 3);
    assert.equal(result[0].query, 'plumber dallas');
    assert.equal(result[0].clicks, 50);
    assert.ok(Math.abs(result[0].confidence - 50 / 105) < 0.001);
    assert.equal(result[1].query, 'plumbing company');
    assert.equal(result[2].query, 'emergency plumber');
});

test('rankQueries: filters to matching page', () => {
    const facts = [
        { query: 'plumber dallas', page: '/services', clicks: 50, impressions: 200 },
        { query: 'about us', page: '/about', clicks: 100, impressions: 500 },
    ];
    const result = rankQueries(facts, '/services');
    assert.equal(result.length, 1);
    assert.equal(result[0].query, 'plumber dallas');
    assert.equal(result[0].confidence, 1);
});

test('rankQueries: empty facts → empty result', () => {
    assert.deepEqual(rankQueries([], '/services'), []);
});

test('rankQueries: normalizes page paths (strips trailing slash)', () => {
    const facts = [
        { query: 'test', page: 'https://client.com/services/', clicks: 10, impressions: 50 },
    ];
    const result = rankQueries(facts, '/services');
    assert.equal(result.length, 1);
});

test('rankQueries: fewer than 3 facts → returns all', () => {
    const facts = [
        { query: 'only one', page: '/contact', clicks: 5, impressions: 20 },
    ];
    const result = rankQueries(facts, '/contact');
    assert.equal(result.length, 1);
    assert.equal(result[0].confidence, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test lib/attribution/query-matcher.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement query matcher (pure logic)**

```ts
// lib/attribution/query-matcher.ts
import type { LikelyQuery } from '../types';

interface GscFact {
    query: string;
    page: string;
    clicks: number;
    impressions: number;
}

function normalizePath(raw: string): string {
    try {
        const url = new URL(raw, 'https://placeholder.com');
        return url.pathname.replace(/\/+$/, '') || '/';
    } catch {
        return (raw.replace(/\/+$/, '') || '/');
    }
}

export function rankQueries(facts: GscFact[], landingPage: string, limit = 3): LikelyQuery[] {
    const target = normalizePath(landingPage);
    const matched = facts.filter(f => normalizePath(f.page) === target && f.clicks > 0);
    if (matched.length === 0) return [];

    matched.sort((a, b) => b.clicks - a.clicks);

    const totalClicks = matched.reduce((sum, f) => sum + f.clicks, 0);
    return matched.slice(0, limit).map(f => ({
        query: f.query,
        clicks: f.clicks,
        confidence: Math.round((f.clicks / totalClicks) * 1000) / 1000,
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test lib/attribution/query-matcher.test.ts
```

Expected: 5 tests, all PASS.

- [ ] **Step 5: Write attribution CRUD**

```ts
// lib/supabase/attribution.ts
import { createClient } from './client';
import { createAdminClient } from './admin';
import type { AttributionSite, AttributionConversion, LikelyQuery, ScriptConfig } from '../types';

function rowToSite(row: any): AttributionSite {
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        domain: row.domain,
        scriptConfig: row.script_config ?? { hdyhau_inject: false, hdyhau_field_patterns: [], track_tel_clicks: true },
        isActive: row.is_active ?? true,
        verifiedAt: row.verified_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToConversion(row: any): AttributionConversion {
    return {
        id: row.id,
        organizationId: row.organization_id,
        siteId: row.site_id,
        clientId: row.client_id,
        eventId: row.event_id,
        conversionType: row.conversion_type,
        sourceCategory: row.source_category,
        landingPage: row.landing_page,
        pageUrl: row.page_url,
        likelyQueries: row.likely_queries ?? [],
        hdyhauResponse: row.hdyhau_response ?? undefined,
        month: row.month,
        createdAt: row.created_at,
    };
}

export async function getAttributionSite(clientId: string): Promise<AttributionSite | null> {
    const supabase = createClient();
    if (!supabase) return null;
    const { data } = await supabase
        .from('attribution_sites')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
    return data ? rowToSite(data) : null;
}

export async function createAttributionSite(params: {
    organizationId: string;
    clientId: string;
    domain: string;
    scriptConfig?: Partial<ScriptConfig>;
}): Promise<AttributionSite> {
    const supabase = createClient();
    if (!supabase) throw new Error('Not authenticated');
    const config: ScriptConfig = {
        hdyhau_inject: false,
        hdyhau_field_patterns: [],
        track_tel_clicks: true,
        ...params.scriptConfig,
    };
    const { data, error } = await supabase
        .from('attribution_sites')
        .insert({
            organization_id: params.organizationId,
            client_id: params.clientId,
            domain: params.domain,
            script_config: config,
        })
        .select()
        .single();
    if (error) throw error;
    return rowToSite(data);
}

export async function updateAttributionSite(
    id: string,
    params: { domain?: string; scriptConfig?: Partial<ScriptConfig>; isActive?: boolean; verifiedAt?: string },
): Promise<AttributionSite> {
    const supabase = createClient();
    if (!supabase) throw new Error('Not authenticated');
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (params.domain !== undefined) row.domain = params.domain;
    if (params.scriptConfig !== undefined) row.script_config = params.scriptConfig;
    if (params.isActive !== undefined) row.is_active = params.isActive;
    if (params.verifiedAt !== undefined) row.verified_at = params.verifiedAt;
    const { data, error } = await supabase
        .from('attribution_sites')
        .update(row)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return rowToSite(data);
}

export async function insertEventsAdmin(rows: Record<string, unknown>[]): Promise<void> {
    const admin = createAdminClient();
    const { error } = await admin.from('attribution_events').insert(rows);
    if (error) throw error;
}

export async function insertConversionAdmin(row: Record<string, unknown>): Promise<string> {
    const admin = createAdminClient();
    const { data, error } = await admin.from('attribution_conversions').insert(row).select('id').single();
    if (error) throw error;
    return data.id;
}

export async function getConversions(
    clientId: string,
    opts: { month?: string; sourceCategory?: string; limit?: number } = {},
): Promise<AttributionConversion[]> {
    const supabase = createClient();
    if (!supabase) return [];
    let q = supabase
        .from('attribution_conversions')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
    if (opts.month) q = q.eq('month', opts.month + '-01');
    if (opts.sourceCategory) q = q.eq('source_category', opts.sourceCategory);
    if (opts.limit) q = q.limit(opts.limit);
    const { data } = await q;
    return (data ?? []).map(rowToConversion);
}

export async function getConversionsMissingQueries(lookbackDays = 7): Promise<{ id: string; clientId: string; landingPage: string; month: string }[]> {
    const admin = createAdminClient();
    const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
    const { data, error } = await admin
        .from('attribution_conversions')
        .select('id, client_id, landing_page, month')
        .is('likely_queries', null)
        .gte('created_at', since);
    if (error) throw error;
    return (data ?? []).map(r => ({ id: r.id, clientId: r.client_id, landingPage: r.landing_page, month: r.month }));
}

export async function updateConversionQueries(id: string, queries: LikelyQuery[]): Promise<void> {
    const admin = createAdminClient();
    const { error } = await admin
        .from('attribution_conversions')
        .update({ likely_queries: queries })
        .eq('id', id);
    if (error) throw error;
}

export async function deleteOldPageviews(retentionDays = 90): Promise<number> {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    const { data, error } = await admin
        .from('attribution_events')
        .delete()
        .eq('event_type', 'pageview')
        .lt('created_at', cutoff)
        .select('id');
    if (error) throw error;
    return data?.length ?? 0;
}

export async function getEventCountsBySource(
    clientId: string,
    month: string,
): Promise<{ sourceCategory: string; count: number }[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data } = await supabase
        .from('attribution_conversions')
        .select('source_category')
        .eq('client_id', clientId)
        .eq('month', month + '-01');
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const row of data) {
        counts.set(row.source_category, (counts.get(row.source_category) ?? 0) + 1);
    }
    return Array.from(counts, ([sourceCategory, count]) => ({ sourceCategory, count }))
        .sort((a, b) => b.count - a.count);
}

export async function getLandingPagePerformance(
    clientId: string,
    month: string,
): Promise<{ landingPage: string; count: number; topQuery: string; organicPct: number }[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data } = await supabase
        .from('attribution_conversions')
        .select('landing_page, source_category, likely_queries')
        .eq('client_id', clientId)
        .eq('month', month + '-01');
    if (!data) return [];
    const pages = new Map<string, { total: number; organic: number; topQuery: string }>();
    for (const row of data) {
        const page = row.landing_page || '/';
        const entry = pages.get(page) ?? { total: 0, organic: 0, topQuery: '' };
        entry.total++;
        if (row.source_category.startsWith('organic_') || row.source_category.startsWith('ai_')) entry.organic++;
        if (!entry.topQuery && row.likely_queries?.[0]?.query) entry.topQuery = row.likely_queries[0].query;
        pages.set(page, entry);
    }
    return Array.from(pages, ([landingPage, v]) => ({
        landingPage,
        count: v.total,
        topQuery: v.topQuery,
        organicPct: v.total > 0 ? Math.round((v.organic / v.total) * 100) : 0,
    })).sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/attribution.ts lib/attribution/query-matcher.ts lib/attribution/query-matcher.test.ts
git commit -m "feat(attribution): add CRUD layer, row mappers, and query matcher"
```

---

### Task 4: Collection Endpoint & Script Delivery

**Files:**
- Create: `app/api/attribution/collect/route.ts`
- Create: `app/api/attribution/s.js/route.ts`

**Interfaces:**
- Consumes: `classifySource` from `lib/attribution/source-classifier.ts`. `insertEventsAdmin`, `insertConversionAdmin` from `lib/supabase/attribution.ts`. `createAdminClient` from `lib/supabase/admin.ts`.
- Produces: `POST /api/attribution/collect` (event ingestion endpoint). `GET /api/attribution/s.js` (tracking script delivery).

- [ ] **Step 1: Implement collection endpoint**

```ts
// app/api/attribution/collect/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { classifySource } from '@/lib/attribution/source-classifier';
import { insertEventsAdmin, insertConversionAdmin } from '@/lib/supabase/attribution';
import { createHash } from 'crypto';

export const maxDuration = 30;

const RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = RATE_LIMIT.get(ip);
    if (!entry || now > entry.resetAt) {
        RATE_LIMIT.set(ip, { count: 1, resetAt: now + 60_000 });
        return false;
    }
    entry.count++;
    return entry.count > 100;
}

function makeVisitorId(ip: string, ua: string): string {
    const salt = new Date().toISOString().slice(0, 10);
    return createHash('sha256').update(`${ip}:${ua}:${salt}`).digest('hex').slice(0, 16);
}

export async function POST(req: NextRequest) {
    try {
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
        if (isRateLimited(ip)) {
            return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
        }

        const body = await req.json();
        const { site_id, events } = body;
        if (!site_id || !Array.isArray(events) || events.length === 0 || events.length > 50) {
            return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
        }

        const admin = createAdminClient();
        const { data: site } = await admin
            .from('attribution_sites')
            .select('id, organization_id, client_id, domain, is_active')
            .eq('id', site_id)
            .single();

        if (!site || !site.is_active) {
            return NextResponse.json({ error: 'invalid_site' }, { status: 404 });
        }

        const origin = req.headers.get('origin') || req.headers.get('referer') || '';
        const originDomain = (() => {
            try { return new URL(origin).hostname.replace(/^www\./, ''); } catch { return ''; }
        })();
        const siteDomain = site.domain.replace(/^www\./, '');
        if (originDomain && originDomain !== siteDomain && !originDomain.endsWith('.' + siteDomain)) {
            return NextResponse.json({ error: 'domain_mismatch' }, { status: 403 });
        }

        const ua = req.headers.get('user-agent') ?? '';
        const visitorId = makeVisitorId(ip, ua);
        const countryCode = req.headers.get('x-vercel-ip-country') ?? null;

        const eventRows: Record<string, unknown>[] = [];
        const conversionPairs: { eventRow: Record<string, unknown>; conversionType: 'form' | 'phone' }[] = [];

        for (const evt of events) {
            const sourceCategory = classifySource(evt.referrer ?? '', evt.utm_medium ?? null, site.domain);

            const row: Record<string, unknown> = {
                organization_id: site.organization_id,
                site_id: site.id,
                event_type: evt.event_type,
                session_id: evt.session_id ?? visitorId,
                visitor_id: visitorId,
                source_category: sourceCategory === 'same_site' ? (evt.session_source ?? 'direct') : sourceCategory,
                referrer_domain: (() => { try { return new URL(evt.referrer).hostname; } catch { return null; } })(),
                landing_page: evt.landing_page ?? evt.page_url ?? '',
                page_url: evt.page_url ?? '',
                hdyhau_response: evt.hdyhau_value ?? null,
                utm_source: evt.utm_source ?? null,
                utm_medium: evt.utm_medium ?? null,
                utm_campaign: evt.utm_campaign ?? null,
                country_code: countryCode,
                device_type: evt.device_type ?? null,
            };

            eventRows.push(row);

            if (evt.event_type === 'form_submit') {
                conversionPairs.push({ eventRow: row, conversionType: 'form' });
            } else if (evt.event_type === 'tel_click') {
                conversionPairs.push({ eventRow: row, conversionType: 'phone' });
            }
        }

        await insertEventsAdmin(eventRows);

        if (conversionPairs.length > 0) {
            const { data: insertedEvents } = await admin
                .from('attribution_events')
                .select('id, event_type, page_url, landing_page, source_category, hdyhau_response')
                .eq('site_id', site.id)
                .in('event_type', ['form_submit', 'tel_click'])
                .eq('visitor_id', visitorId)
                .order('created_at', { ascending: false })
                .limit(conversionPairs.length);

            for (const evt of insertedEvents ?? []) {
                const month = new Date().toISOString().slice(0, 7) + '-01';
                await insertConversionAdmin({
                    organization_id: site.organization_id,
                    site_id: site.id,
                    client_id: site.client_id,
                    event_id: evt.id,
                    conversion_type: evt.event_type === 'form_submit' ? 'form' : 'phone',
                    source_category: evt.source_category,
                    landing_page: evt.landing_page ?? '',
                    page_url: evt.page_url ?? '',
                    hdyhau_response: evt.hdyhau_response ?? null,
                    month,
                });
            }
        }

        return NextResponse.json({ ok: true }, {
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
        });
    } catch (err: any) {
        console.error('[attribution/collect]', err.message);
        return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
```

- [ ] **Step 2: Implement tracking script delivery endpoint**

```ts
// app/api/attribution/s.js/route.ts
import { NextRequest, NextResponse } from 'next/server';

const SCRIPT = `(function(){
  var ENDPOINT='/api/attribution/collect';
  var el=document.currentScript;
  if(!el)return;
  var siteId=el.getAttribute('data-site');
  if(!siteId)return;
  var origin=el.src.replace(/\\/api\\/attribution\\/s\\.js.*/,'');

  var S=sessionStorage;
  var SK='_attr';
  var sess;
  try{sess=JSON.parse(S.getItem(SK));}catch(e){}

  function utmParam(n){try{return new URLSearchParams(location.search).get(n)||'';}catch(e){return '';}}
  function devType(){return /Mobi|Android/i.test(navigator.userAgent)?'mobile':/Tablet|iPad/i.test(navigator.userAgent)?'tablet':'desktop';}
  function uuid(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16);});}

  if(!sess){
    sess={sid:uuid(),src:document.referrer,lp:location.pathname};
    try{S.setItem(SK,JSON.stringify(sess));}catch(e){}
  }

  var queue=[];
  function push(type,extra){
    queue.push(Object.assign({
      event_type:type,
      page_url:location.pathname,
      referrer:document.referrer,
      session_id:sess.sid,
      landing_page:sess.lp,
      session_source:sess.src,
      utm_source:utmParam('utm_source'),
      utm_medium:utmParam('utm_medium'),
      utm_campaign:utmParam('utm_campaign'),
      device_type:devType(),
      timestamp:new Date().toISOString()
    },extra||{}));
  }

  function flush(){
    if(!queue.length)return;
    var batch=queue.splice(0);
    var body=JSON.stringify({site_id:siteId,events:batch});
    if(navigator.sendBeacon){navigator.sendBeacon(origin+ENDPOINT,new Blob([body],{type:'application/json'}));}
    else{try{var x=new XMLHttpRequest();x.open('POST',origin+ENDPOINT,false);x.setRequestHeader('Content-Type','application/json');x.send(body);}catch(e){}}
  }

  push('pageview');

  function findHdyhau(form){
    var sels=form.querySelectorAll('select,input[type=radio]');
    for(var i=0;i<sels.length;i++){
      var n=(sels[i].name||sels[i].id||'').toLowerCase();
      if(/hear|found|source|referral|how_did/.test(n)){
        return sels[i].value||'';
      }
    }
    return '';
  }

  document.addEventListener('submit',function(e){
    var form=e.target;
    if(!form||form.tagName!=='FORM')return;
    var val=findHdyhau(form);
    push('form_submit',{hdyhau_value:val||null});
    flush();
  },true);

  document.addEventListener('click',function(e){
    var a=e.target;
    while(a&&a.tagName!=='A')a=a.parentElement;
    if(a&&a.href&&a.href.indexOf('tel:')===0){
      push('tel_click');
      flush();
    }
  },true);

  var timer;
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});
  window.addEventListener('pagehide',flush);
  timer=setInterval(function(){if(queue.length)flush();},5000);
})();`;

export async function GET(req: NextRequest) {
    return new NextResponse(SCRIPT, {
        status: 200,
        headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/attribution/collect/route.ts app/api/attribution/s.js/route.ts
git commit -m "feat(attribution): add collection endpoint and tracking script delivery"
```

---

### Task 5: Cron Jobs (GSC Query Matcher & Event Cleanup)

**Files:**
- Create: `app/api/cron/attribution-queries/route.ts`
- Create: `app/api/cron/attribution-cleanup/route.ts`
- Modify: `vercel.json` (add cron schedules)

**Interfaces:**
- Consumes: `getConversionsMissingQueries`, `updateConversionQueries`, `deleteOldPageviews` from `lib/supabase/attribution.ts`. `rankQueries` from `lib/attribution/query-matcher.ts`. `createAdminClient` from `lib/supabase/admin.ts`.

- [ ] **Step 1: Implement GSC query cross-reference cron**

```ts
// app/api/cron/attribution-queries/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConversionsMissingQueries, updateConversionQueries } from '@/lib/supabase/attribution';
import { rankQueries } from '@/lib/attribution/query-matcher';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const conversions = await getConversionsMissingQueries(7);

    let matched = 0;
    for (const conv of conversions) {
        const monthDate = typeof conv.month === 'string' ? conv.month.slice(0, 7) : new Date(conv.month).toISOString().slice(0, 7);

        const { data: days } = await admin
            .from('gsc_history_days')
            .select('id')
            .eq('client_id', conv.clientId)
            .gte('data_date', monthDate + '-01')
            .lte('data_date', monthDate + '-31');

        if (!days || days.length === 0) continue;

        const dayIds = days.map(d => d.id);
        const { data: facts } = await admin
            .from('gsc_history_facts')
            .select('query, page, clicks, impressions')
            .in('day_id', dayIds)
            .eq('grain', 'query_page')
            .gt('clicks', 0);

        if (!facts || facts.length === 0) continue;

        const queries = rankQueries(facts, conv.landingPage);
        if (queries.length > 0) {
            await updateConversionQueries(conv.id, queries);
            matched++;
        }
    }

    return NextResponse.json({
        total: conversions.length,
        matched,
        timestamp: new Date().toISOString(),
    });
}
```

- [ ] **Step 2: Implement event retention cleanup cron**

```ts
// app/api/cron/attribution-cleanup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { deleteOldPageviews } from '@/lib/supabase/attribution';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const deleted = await deleteOldPageviews(90);

    return NextResponse.json({
        deleted,
        timestamp: new Date().toISOString(),
    });
}
```

- [ ] **Step 3: Add cron schedules to `vercel.json`**

Add two entries to the `crons` array:

```json
{
    "path": "/api/cron/attribution-queries",
    "schedule": "0 9 * * *"
},
{
    "path": "/api/cron/attribution-cleanup",
    "schedule": "0 10 * * *"
}
```

(09:00 UTC = 3am CT; 10:00 UTC = 4am CT — after the existing 08:00 UTC metric sync.)

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/attribution-queries/route.ts app/api/cron/attribution-cleanup/route.ts vercel.json
git commit -m "feat(attribution): add GSC query matcher and event cleanup cron jobs"
```

---

### Task 6: Workspace Attribution Tab — Setup & Dashboard

**Files:**
- Create: `components/attribution/AttributionTab.tsx`
- Create: `components/attribution/AttributionSetup.tsx`
- Create: `components/attribution/SourceDonut.tsx`
- Create: `components/attribution/ConversionTimeline.tsx`
- Create: `components/attribution/ConversionLog.tsx`
- Create: `components/attribution/LandingPagePerformance.tsx`
- Create: `components/attribution/RoiCard.tsx`
- Modify: `app/(dashboard)/workspace/[id]/page.tsx` (add Attribution tab)

**Interfaces:**
- Consumes: `getAttributionSite`, `createAttributionSite`, `updateAttributionSite`, `getConversions`, `getEventCountsBySource`, `getLandingPagePerformance` from `lib/supabase/attribution.ts`. `ClientProject` from `lib/types.ts`.
- Produces: `<AttributionTab clientId={string} organizationId={string} client={ClientProject} />` component.

This task is UI-heavy. Each component follows the same pattern as existing workspace tabs (e.g., `SearchInsightsTab`, `SiteInventoryTab`). Steps below show the component structure and key code — full styling follows existing Tailwind + shadcn conventions used throughout the app.

- [ ] **Step 1: Create RoiCard component**

```tsx
// components/attribution/RoiCard.tsx
'use client';

interface RoiCardProps {
    conversions: number;
    avgDealValue: number | undefined;
    monthlyRetainer: number;
}

export function RoiCard({ conversions, avgDealValue, monthlyRetainer }: RoiCardProps) {
    if (!avgDealValue || conversions === 0) {
        return (
            <div className="rounded-lg border border-border/50 bg-card p-4">
                <p className="text-sm text-muted-foreground">
                    {!avgDealValue
                        ? 'Set an average deal value in Attribution Setup to see ROI calculations.'
                        : 'No conversions this month yet.'}
                </p>
            </div>
        );
    }

    const pipeline = conversions * avgDealValue;
    const roi = monthlyRetainer > 0 ? Math.round((pipeline / monthlyRetainer) * 10) / 10 : 0;

    return (
        <div className="rounded-lg border border-border/50 bg-card p-4 space-y-1">
            <div className="text-sm text-muted-foreground">Estimated Pipeline</div>
            <div className="text-2xl font-bold">
                SEO drove <span className="text-primary">{conversions} leads</span> ×{' '}
                ${avgDealValue.toLocaleString()} avg ={' '}
                <span className="text-green-500">${pipeline.toLocaleString()}</span>
            </div>
            {monthlyRetainer > 0 && (
                <div className="text-sm text-muted-foreground">
                    Retainer: ${monthlyRetainer.toLocaleString()} → <span className="font-semibold text-green-500">{roi}x ROI</span>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Create SourceDonut component**

```tsx
// components/attribution/SourceDonut.tsx
'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const SOURCE_COLORS: Record<string, string> = {
    organic_google: '#22c55e',
    organic_bing: '#3b82f6',
    organic_other: '#6366f1',
    ai_chatgpt: '#a855f7',
    ai_perplexity: '#8b5cf6',
    ai_google_aio: '#14b8a6',
    social: '#f59e0b',
    paid: '#ef4444',
    direct: '#6b7280',
    referral: '#ec4899',
};

const SOURCE_LABELS: Record<string, string> = {
    organic_google: 'Organic Google',
    organic_bing: 'Organic Bing',
    organic_other: 'Organic Other',
    ai_chatgpt: 'AI ChatGPT',
    ai_perplexity: 'AI Perplexity',
    ai_google_aio: 'AI Google AIO',
    social: 'Social',
    paid: 'Paid',
    direct: 'Direct',
    referral: 'Referral',
};

interface Props {
    data: { sourceCategory: string; count: number }[];
}

export function SourceDonut({ data }: Props) {
    if (data.length === 0) {
        return <p className="text-sm text-muted-foreground py-8 text-center">No conversion data yet.</p>;
    }

    const chartData = data.map(d => ({
        name: SOURCE_LABELS[d.sourceCategory] ?? d.sourceCategory,
        value: d.count,
        color: SOURCE_COLORS[d.sourceCategory] ?? '#94a3b8',
    }));

    return (
        <ResponsiveContainer width="100%" height={280}>
            <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                    {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                    ))}
                </Pie>
                <Tooltip />
                <Legend />
            </PieChart>
        </ResponsiveContainer>
    );
}
```

- [ ] **Step 3: Create ConversionTimeline component**

```tsx
// components/attribution/ConversionTimeline.tsx
'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { AttributionConversion } from '@/lib/types';

interface Props {
    conversions: AttributionConversion[];
}

export function ConversionTimeline({ conversions }: Props) {
    if (conversions.length === 0) {
        return <p className="text-sm text-muted-foreground py-8 text-center">No conversions this period.</p>;
    }

    const byDay = new Map<string, { organic: number; ai: number; other: number }>();
    for (const c of conversions) {
        const day = c.createdAt.slice(0, 10);
        const entry = byDay.get(day) ?? { organic: 0, ai: 0, other: 0 };
        if (c.sourceCategory.startsWith('organic_')) entry.organic++;
        else if (c.sourceCategory.startsWith('ai_')) entry.ai++;
        else entry.other++;
        byDay.set(day, entry);
    }

    const data = Array.from(byDay, ([date, counts]) => ({ date: date.slice(5), ...counts }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return (
        <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis allowDecimals={false} className="text-xs" />
                <Tooltip />
                <Bar dataKey="organic" stackId="a" fill="#22c55e" name="Organic" />
                <Bar dataKey="ai" stackId="a" fill="#a855f7" name="AI Search" />
                <Bar dataKey="other" stackId="a" fill="#6b7280" name="Other" />
            </BarChart>
        </ResponsiveContainer>
    );
}
```

- [ ] **Step 4: Create ConversionLog component**

```tsx
// components/attribution/ConversionLog.tsx
'use client';

import type { AttributionConversion } from '@/lib/types';

const SOURCE_LABELS: Record<string, string> = {
    organic_google: 'Organic Google',
    organic_bing: 'Organic Bing',
    organic_other: 'Organic Other',
    ai_chatgpt: 'AI ChatGPT',
    ai_perplexity: 'AI Perplexity',
    ai_google_aio: 'AI Google AIO',
    social: 'Social',
    paid: 'Paid',
    direct: 'Direct',
    referral: 'Referral',
};

interface Props {
    conversions: AttributionConversion[];
}

export function ConversionLog({ conversions }: Props) {
    if (conversions.length === 0) {
        return <p className="text-sm text-muted-foreground py-8 text-center">No conversions recorded yet.</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-border/50 text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Date</th>
                        <th className="py-2 pr-4 font-medium">Page</th>
                        <th className="py-2 pr-4 font-medium">Source</th>
                        <th className="py-2 pr-4 font-medium">Likely Queries</th>
                        <th className="py-2 pr-4 font-medium">HDYHAU</th>
                        <th className="py-2 font-medium">Type</th>
                    </tr>
                </thead>
                <tbody>
                    {conversions.map(c => (
                        <tr key={c.id} className="border-b border-border/30 hover:bg-muted/30">
                            <td className="py-2 pr-4 whitespace-nowrap">
                                {new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="py-2 pr-4 font-mono text-xs max-w-[200px] truncate" title={c.pageUrl}>
                                {c.pageUrl || '/'}
                            </td>
                            <td className="py-2 pr-4 whitespace-nowrap">
                                {SOURCE_LABELS[c.sourceCategory] ?? c.sourceCategory}
                            </td>
                            <td className="py-2 pr-4 text-xs max-w-[250px]">
                                {c.likelyQueries.length > 0
                                    ? c.likelyQueries.map((q, i) => (
                                        <span key={i}>
                                            {q.query} <span className="text-muted-foreground">({Math.round(q.confidence * 100)}%)</span>
                                            {i < c.likelyQueries.length - 1 && ', '}
                                        </span>
                                    ))
                                    : <span className="text-muted-foreground">—</span>
                                }
                            </td>
                            <td className="py-2 pr-4 text-xs">
                                {c.hdyhauResponse || <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2 capitalize">{c.conversionType}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
```

- [ ] **Step 5: Create LandingPagePerformance component**

```tsx
// components/attribution/LandingPagePerformance.tsx
'use client';

interface PageRow {
    landingPage: string;
    count: number;
    topQuery: string;
    organicPct: number;
}

interface Props {
    pages: PageRow[];
}

export function LandingPagePerformance({ pages }: Props) {
    if (pages.length === 0) {
        return <p className="text-sm text-muted-foreground py-4 text-center">No landing page data yet.</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-border/50 text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Page</th>
                        <th className="py-2 pr-4 font-medium">Conversions</th>
                        <th className="py-2 pr-4 font-medium">Top Query</th>
                        <th className="py-2 font-medium">Organic %</th>
                    </tr>
                </thead>
                <tbody>
                    {pages.map(p => (
                        <tr key={p.landingPage} className="border-b border-border/30 hover:bg-muted/30">
                            <td className="py-2 pr-4 font-mono text-xs max-w-[200px] truncate" title={p.landingPage}>
                                {p.landingPage}
                            </td>
                            <td className="py-2 pr-4 font-semibold">{p.count}</td>
                            <td className="py-2 pr-4 text-xs">{p.topQuery || '—'}</td>
                            <td className="py-2">
                                <span className={p.organicPct >= 50 ? 'text-green-500' : 'text-muted-foreground'}>
                                    {p.organicPct}%
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
```

- [ ] **Step 6: Create AttributionSetup component**

```tsx
// components/attribution/AttributionSetup.tsx
'use client';

import { useState } from 'react';
import { createAttributionSite, updateAttributionSite } from '@/lib/supabase/attribution';
import type { AttributionSite, ClientProject } from '@/lib/types';

interface Props {
    organizationId: string;
    client: ClientProject;
    site: AttributionSite | null;
    onSiteCreated: (site: AttributionSite) => void;
}

export function AttributionSetup({ organizationId, client, site, onSiteCreated }: Props) {
    const [domain, setDomain] = useState(site?.domain ?? client.domain ?? '');
    const [avgDealValue, setAvgDealValue] = useState<string>(
        client.avgDealValue != null ? String(client.avgDealValue) : ''
    );
    const [saving, setSaving] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [verified, setVerified] = useState(!!site?.verifiedAt);
    const [copied, setCopied] = useState(false);

    const siteId = site?.id ?? '(create site first)';
    const scriptSnippet = `<script defer src="${typeof window !== 'undefined' ? window.location.origin : 'https://seo-ops-center.vercel.app'}/api/attribution/s.js" data-site="${siteId}"></script>`;

    const handleCreate = async () => {
        if (!domain.trim()) return;
        setSaving(true);
        try {
            const created = await createAttributionSite({
                organizationId,
                clientId: client.id,
                domain: domain.trim(),
            });
            onSiteCreated(created);
        } catch (err: any) {
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(scriptSnippet);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleVerify = async () => {
        if (!site) return;
        setVerifying(true);
        try {
            const res = await fetch(`https://${site.domain}`, { mode: 'no-cors' });
            await updateAttributionSite(site.id, { verifiedAt: new Date().toISOString() });
            setVerified(true);
        } catch {
            setVerified(false);
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="rounded-lg border border-border/50 bg-card p-6 space-y-4">
            <h3 className="text-lg font-semibold">Attribution Setup</h3>

            <div className="space-y-2">
                <label className="text-sm font-medium">Website Domain</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={domain}
                        onChange={e => setDomain(e.target.value)}
                        placeholder="www.clientsite.com"
                        className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                    {!site && (
                        <button onClick={handleCreate} disabled={saving || !domain.trim()} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                            {saving ? 'Creating...' : 'Create Site'}
                        </button>
                    )}
                </div>
            </div>

            {site && (
                <>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Tracking Script</label>
                        <div className="relative">
                            <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto">{scriptSnippet}</pre>
                            <button onClick={handleCopy} className="absolute top-2 right-2 px-2 py-1 rounded text-xs bg-background border border-border hover:bg-muted">
                                {copied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={handleVerify} disabled={verifying} className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50">
                            {verifying ? 'Checking...' : 'Verify Installation'}
                        </button>
                        {verified && <span className="text-sm text-green-500">✓ Verified</span>}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Average Deal Value ($)</label>
                        <input
                            type="number"
                            value={avgDealValue}
                            onChange={e => setAvgDealValue(e.target.value)}
                            placeholder="e.g. 4500"
                            className="w-48 rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                        <p className="text-xs text-muted-foreground">Used to estimate pipeline ROI from organic conversions.</p>
                    </div>
                </>
            )}
        </div>
    );
}
```

- [ ] **Step 7: Create AttributionTab orchestrator**

```tsx
// components/attribution/AttributionTab.tsx
'use client';

import { useEffect, useState } from 'react';
import { getAttributionSite, getConversions, getEventCountsBySource, getLandingPagePerformance } from '@/lib/supabase/attribution';
import type { AttributionSite, AttributionConversion, ClientProject } from '@/lib/types';
import { AttributionSetup } from './AttributionSetup';
import { RoiCard } from './RoiCard';
import { SourceDonut } from './SourceDonut';
import { ConversionTimeline } from './ConversionTimeline';
import { ConversionLog } from './ConversionLog';
import { LandingPagePerformance } from './LandingPagePerformance';

interface Props {
    organizationId: string;
    clientId: string;
    client: ClientProject;
}

export function AttributionTab({ organizationId, clientId, client }: Props) {
    const [site, setSite] = useState<AttributionSite | null | undefined>(undefined);
    const [conversions, setConversions] = useState<AttributionConversion[]>([]);
    const [sourceCounts, setSourceCounts] = useState<{ sourceCategory: string; count: number }[]>([]);
    const [pagePerf, setPagePerf] = useState<{ landingPage: string; count: number; topQuery: string; organicPct: number }[]>([]);

    const month = new Date().toISOString().slice(0, 7);

    useEffect(() => {
        getAttributionSite(clientId).then(setSite);
    }, [clientId]);

    useEffect(() => {
        if (site === undefined || site === null) return;
        Promise.all([
            getConversions(clientId, { month }),
            getEventCountsBySource(clientId, month),
            getLandingPagePerformance(clientId, month),
        ]).then(([convs, sources, pages]) => {
            setConversions(convs);
            setSourceCounts(sources);
            setPagePerf(pages);
        });
    }, [site, clientId, month]);

    if (site === undefined) {
        return <p className="text-muted-foreground py-4">Loading attribution...</p>;
    }

    if (site === null || !site.verifiedAt) {
        return (
            <AttributionSetup
                organizationId={organizationId}
                client={client}
                site={site}
                onSiteCreated={setSite}
            />
        );
    }

    const totalConversions = sourceCounts.reduce((sum, s) => sum + s.count, 0);
    const retainer = (client.seoHours ?? 0) * 150;

    return (
        <div className="space-y-6">
            <RoiCard conversions={totalConversions} avgDealValue={client.avgDealValue} monthlyRetainer={retainer} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-lg border border-border/50 bg-card p-4">
                    <h3 className="text-sm font-semibold mb-3">Source Breakdown</h3>
                    <SourceDonut data={sourceCounts} />
                </div>
                <div className="rounded-lg border border-border/50 bg-card p-4">
                    <h3 className="text-sm font-semibold mb-3">Conversion Timeline</h3>
                    <ConversionTimeline conversions={conversions} />
                </div>
            </div>

            <div className="rounded-lg border border-border/50 bg-card p-4">
                <h3 className="text-sm font-semibold mb-3">Conversion Log</h3>
                <ConversionLog conversions={conversions} />
            </div>

            <div className="rounded-lg border border-border/50 bg-card p-4">
                <h3 className="text-sm font-semibold mb-3">Landing Page Performance</h3>
                <LandingPagePerformance pages={pagePerf} />
            </div>
        </div>
    );
}
```

- [ ] **Step 8: Add Attribution tab to workspace page**

In `app/(dashboard)/workspace/[id]/page.tsx`:

1. Add `'attribution'` to the `Tab` type union:

```ts
type Tab = 'overview' | 'campaign' | 'tasks' | 'integrations' | 'insights' | 'inventory' | 'attribution';
```

2. Add the import:

```ts
import { AttributionTab } from '@/components/attribution/AttributionTab';
```

3. Add a tab button in the tab bar (before Integrations):

```tsx
<button
    onClick={() => setActiveTab('attribution')}
    className={cn('flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors', activeTab === 'attribution' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
>Attribution</button>
```

4. Add the tab content (alongside the other `activeTab === '...'` blocks):

```tsx
{activeTab === 'attribution' && (
    <AttributionTab
        organizationId={organization?.id ?? ''}
        clientId={client.id}
        client={client}
    />
)}
```

- [ ] **Step 9: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 10: Commit**

```bash
git add components/attribution/ app/(dashboard)/workspace/\[id\]/page.tsx
git commit -m "feat(attribution): add workspace Attribution tab with dashboard components"
```

---

### Task 7: End-to-End Verification

**Files:** None new — verification only.

**Interfaces:** None — this task validates the full loop.

- [ ] **Step 1: Run all tests**

```bash
node --test lib/attribution/source-classifier.test.ts lib/attribution/query-matcher.test.ts
```

Expected: All tests pass.

- [ ] **Step 2: Run full type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Start dev server and verify Attribution tab**

Start the dev server. Navigate to a client workspace. Verify the Attribution tab appears in the tab bar. Click it — it should show the AttributionSetup card (no site configured yet).

- [ ] **Step 4: Apply migration 056 to Sandbox**

Run `migrations/056_attribution.sql` in the Supabase SQL editor. Verify tables exist:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('attribution_sites', 'attribution_events', 'attribution_conversions')
order by table_name;
```

- [ ] **Step 5: Test the collection endpoint**

Using the sandbox client, create an attribution site via the setup card. Then test the collection endpoint with curl:

```bash
curl -X POST https://localhost:3000/api/attribution/collect \
  -H "Content-Type: application/json" \
  -H "Origin: https://SANDBOX_CLIENT_DOMAIN" \
  -d '{"site_id":"SITE_ID","events":[{"event_type":"form_submit","page_url":"/contact","referrer":"https://www.google.com/","session_id":"test-123","device_type":"desktop","timestamp":"2026-09-12T14:30:00Z"}]}'
```

Expected: `{"ok":true}` and a row in both `attribution_events` and `attribution_conversions`.

- [ ] **Step 6: Verify dashboard renders with test data**

Reload the Attribution tab for the sandbox client. The source donut, conversion log, and timeline should render the test conversion.

- [ ] **Step 7: Final commit and push**

```bash
npx tsc --noEmit
git push -u origin feat/attribution-design-spec
```
