/**
 * Run with: node --import tsx --test lib/campaign-workspace/content-plan.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentPlanTable } from '../../components/campaign-workspace/ContentPlanTable.tsx';
import {
    CONTENT_PLAN_COLUMNS,
    CONTENT_PLAN_HONESTY,
    contentPlanCalendarDates,
    contentPlanDraftFromRow,
    contentPlanForMonth,
    contentPlanInsertRow,
    contentPlanMetricLabel,
    contentPlanPublication,
    contentPlanUpdateRow,
    contentPlanView,
    emptyContentPlanDraft,
    normalizeContentPlanDraft,
    readContentPlanDifficulty,
    readContentPlanMonth,
    readContentPlanRow,
    readContentPlanStatus,
    readContentPlanType,
    readContentPlanVolume,
    type ContentPlanDraft,
    type ContentPlanRow,
} from './content-plan.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const EXAMPLE_TITLE = 'EXAMPLE: How Much Does a Kitchen Remodel Cost in 2026?';

function draft(overrides: Partial<ContentPlanDraft> = {}): ContentPlanDraft {
    return { ...emptyContentPlanDraft(), title: 'Emergency service page', ...overrides };
}

function row(overrides: Partial<ContentPlanRow> = {}): ContentPlanRow {
    return {
        id: 'row-1',
        organizationId: 'org',
        clientId: 'client',
        planMonth: '2026-10',
        publishedOn: null,
        status: null,
        contentType: null,
        title: 'Emergency service page',
        keyword: null,
        searchVolume: null,
        keywordDifficulty: null,
        dueOn: null,
        draftUrl: null,
        liveUrl: null,
        matchingProduct: null,
        internalUrl: null,
        createdAt: '2026-10-02T15:00:00.000Z',
        ...overrides,
    };
}

function field(html: string, name: string): string {
    const start = html.indexOf(`data-field="${name}"`);
    assert.ok(start >= 0, name);
    const end = html.indexOf('</td>', start);
    return html.slice(start, end);
}

test('an empty content plan stays empty and does not invent a month or a zero', () => {
    assert.deepEqual(contentPlanForMonth([], '2026-10'), []);
    assert.deepEqual(contentPlanForMonth([row()], '2026-11'), []);
    assert.deepEqual(contentPlanForMonth([row()], 'October 2026'), []);
    assert.equal(readContentPlanMonth('2026-10'), '2026-10');
    assert.equal(readContentPlanMonth('October 2026'), null);
    assert.equal(readContentPlanMonth('3'), null);
    assert.equal(readContentPlanMonth('Month 3'), null);

    const html = renderToStaticMarkup(createElement(ContentPlanTable, {
        month: '2026-10',
        rows: [],
        mode: 'ready',
    }));
    assert.match(html, /No content for October 2026/);
    assert.equal(html.includes(EXAMPLE_TITLE), false);
    assert.equal(html.includes('>0<'), false);
    assert.equal(html.includes('value="0"'), false);
    assert.equal(html.includes('type="month"'), false);
    assert.equal(html.includes('name="month"'), false);
    assert.match(html, /data-content-plan-month="2026-10"/);
    assert.match(html, /follows the work month/);
    let cursor = html.indexOf('<thead');
    for (const column of CONTENT_PLAN_COLUMNS) {
        const at = html.indexOf(`>${column}</th>`, cursor);
        assert.ok(at > cursor, column);
        cursor = at;
    }
});

test('unset volume, difficulty, and links display as unset and are not stored as zero', () => {
    const blank = normalizeContentPlanDraft(draft());
    assert.equal(blank.ok, true);
    if (!blank.ok) return;
    assert.equal(blank.value.searchVolume, null);
    assert.equal(blank.value.keywordDifficulty, null);
    assert.equal(blank.value.draftUrl, null);
    assert.equal(blank.value.liveUrl, null);
    assert.equal(blank.value.internalUrl, null);
    assert.equal(blank.value.status, null);
    assert.equal(blank.value.publishedOn, null);
    assert.equal(blank.value.dueOn, null);

    const dashed = normalizeContentPlanDraft(draft({ searchVolume: '—', keywordDifficulty: '—', draftUrl: '—' }));
    assert.equal(dashed.ok, true);
    if (!dashed.ok) return;
    assert.equal(dashed.value.searchVolume, null);
    assert.equal(dashed.value.keywordDifficulty, null);
    assert.equal(dashed.value.draftUrl, null);

    const zero = normalizeContentPlanDraft(draft({ searchVolume: '0', keywordDifficulty: '0' }));
    assert.equal(zero.ok, true);
    if (!zero.ok) return;
    assert.equal(zero.value.searchVolume, 0);
    assert.equal(zero.value.keywordDifficulty, 0);
    assert.equal(normalizeContentPlanDraft(draft({ searchVolume: '1.5' })).ok, false);
    assert.equal(normalizeContentPlanDraft(draft({ keywordDifficulty: '101' })).ok, false);
    assert.equal(normalizeContentPlanDraft(draft({ searchVolume: 'zero' })).ok, false);

    assert.equal(readContentPlanVolume(null), null);
    assert.equal(readContentPlanVolume(undefined), null);
    assert.equal(readContentPlanVolume(''), null);
    assert.equal(readContentPlanVolume('—'), null);
    assert.equal(readContentPlanVolume(0), 0);
    assert.equal(readContentPlanDifficulty(null), null);
    assert.equal(contentPlanMetricLabel(null), '—');
    assert.equal(contentPlanMetricLabel(0), '0');

    const stored = readContentPlanRow({
        id: 'row-1',
        organization_id: 'org',
        client_id: 'client',
        plan_month: '2026-10',
        title: 'Emergency service page',
        status: 'published',
        content_type: 'Blog Post',
        search_volume: null,
        keyword_difficulty: null,
        draft_url: '',
        live_url: 'javascript:alert(1)',
        internal_url: null,
        target_month: 3,
        published_on: null,
        due_on: null,
    });
    assert.ok(stored);
    assert.equal(stored?.searchVolume, null);
    assert.equal(stored?.keywordDifficulty, null);
    assert.equal(stored?.draftUrl, null);
    assert.equal(stored?.liveUrl, null);
    assert.equal(stored?.internalUrl, null);
    assert.equal(stored?.contentType, null);
    assert.equal(contentPlanDraftFromRow(stored!).searchVolume, '');
    assert.equal(contentPlanDraftFromRow(stored!).keywordDifficulty, '');
    const view = contentPlanView(stored!);
    assert.equal(view.volume, '—');
    assert.equal(view.difficulty, '—');
    assert.equal(view.draftUrl, null);
    assert.equal(view.liveUrl, null);
    assert.equal(view.internalUrl, null);
    assert.equal(view.monthLabel, 'October 2026');

    const html = renderToStaticMarkup(createElement(ContentPlanTable, {
        month: '2026-10',
        rows: [stored!],
        mode: 'ready',
    }));
    for (const name of ['volume', 'difficulty', 'draft-link', 'live-link', 'internal-link']) {
        const cell = field(html, name);
        assert.match(cell, /data-unset="true"/);
        assert.match(cell, /—/);
        assert.equal(cell.includes('>0<'), false);
        assert.equal(cell.includes('value="0"'), false);
        assert.equal(cell.includes('<a '), false);
    }
    assert.equal(field(html, 'month').includes('<input'), false);
    assert.match(field(html, 'month'), /October 2026/);
});

test('unknown status and content type labels are rejected on write and read as null', () => {
    assert.equal(readContentPlanStatus('Published'), null);
    assert.equal(readContentPlanStatus('Idea'), null);
    assert.equal(readContentPlanStatus('completed_verified'), null);
    assert.equal(readContentPlanStatus('published'), 'published');
    assert.equal(readContentPlanStatus('—'), null);
    assert.equal(readContentPlanStatus(''), null);
    assert.equal(readContentPlanType('Blog Post'), null);
    assert.equal(readContentPlanType('Pillar Page'), null);
    assert.equal(readContentPlanType('blog_post'), 'blog_post');
    assert.equal(readContentPlanType(null), null);

    for (const status of ['Published', 'Idea', 'Keyword Approved', 'In Progress', 'completed_verified', 'Blog Post']) {
        const result = normalizeContentPlanDraft(draft({ status }));
        assert.equal(result.ok, false, status);
        if (!result.ok) assert.match(result.error, /Status/);
    }
    for (const contentType of ['Blog Post', 'Service Page', 'Location Page', 'Landing Page', 'Pillar Page', 'Product Page', 'FAQ Page', 'Case Study']) {
        const result = normalizeContentPlanDraft(draft({ contentType }));
        assert.equal(result.ok, false, contentType);
        if (!result.ok) assert.match(result.error, /Content type/);
    }

    const cleared = normalizeContentPlanDraft(draft({ status: '—', contentType: '-' }));
    assert.equal(cleared.ok, true);
    if (!cleared.ok) return;
    assert.equal(cleared.value.status, null);
    assert.equal(cleared.value.contentType, null);

    const saved = normalizeContentPlanDraft(draft({ status: 'keyword_approved', contentType: 'service_page' }));
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.value.status, 'keyword_approved');
    assert.equal(saved.value.contentType, 'service_page');

    const html = renderToStaticMarkup(createElement(ContentPlanTable, {
        month: '2026-10',
        rows: [],
        mode: 'ready',
    }));
    assert.match(html, /<option value=""[^>]*>—<\/option>/);
    assert.match(html, /<option value="idea">Idea<\/option>/);
    assert.match(html, /<option value="keyword_approved">Keyword Approved<\/option>/);
    assert.match(html, /<option value="published">Published<\/option>/);
    assert.match(html, /<option value="blog_post">Blog Post<\/option>/);
    assert.match(html, /<option value="case_study">Case Study<\/option>/);
    assert.equal(html.includes('value="Idea"'), false);
    assert.equal(html.includes('value="Published"'), false);
    assert.equal(html.includes('value="Blog Post"'), false);
    assert.equal(html.includes('value="completed_verified"'), false);
    assert.equal(html.includes('<option value="draft"'), false);
});

test('published is a content status and is not verified performance', () => {
    const publication = contentPlanPublication('published');
    assert.equal(publication.published, true);
    assert.equal(publication.indexed, false);
    assert.equal(publication.performing, false);
    assert.equal(publication.verified, false);
    assert.equal(publication.label, 'Published');
    assert.notEqual(publication.label, 'Completed & Verified');
    assert.equal(contentPlanPublication(null).published, false);
    assert.equal(contentPlanPublication('idea').verified, false);

    const written = normalizeContentPlanDraft(draft({ status: 'published' }));
    assert.equal(written.ok, true);
    if (!written.ok) return;
    assert.equal(written.value.status, 'published');
    assert.equal(written.value.liveUrl, null);
    assert.equal(written.value.publishedOn, null);

    const view = contentPlanView(row({ status: 'published' }));
    assert.equal(view.published, true);
    assert.equal(view.indexed, false);
    assert.equal(view.performing, false);
    assert.equal(view.verified, false);
    assert.equal(view.statusLabel, 'Published');

    const html = renderToStaticMarkup(createElement(ContentPlanTable, {
        month: '2026-10',
        rows: [row({ status: 'published', title: 'Emergency service page' })],
        mode: 'ready',
    }));
    assert.match(html, /data-content-status="published"/);
    assert.match(html, /data-published="true"/);
    assert.match(html, /data-indexed="false"/);
    assert.match(html, /data-performing="false"/);
    assert.match(html, /data-verified="false"/);
    assert.equal(html.includes(CONTENT_PLAN_HONESTY), true);
    assert.match(field(html, 'status'), /Published/);
    assert.equal(html.includes('Completed &amp; Verified'), false);
    assert.equal(html.includes('Completed & Verified'), false);
    assert.equal(html.includes('On track'), false);
    assert.equal(html.includes('progressbar'), false);
    assert.equal(html.includes('<progress'), false);
    assert.equal(html.includes('%'), false);
});

test('published date and due date are calendar dates and ignore the engagement month', () => {
    assert.deepEqual(
        contentPlanCalendarDates({ publishedOn: null, dueOn: '', targetMonth: 3, planMonth: '2026-10' }),
        { publishedOn: null, dueOn: null },
    );
    assert.deepEqual(
        contentPlanCalendarDates({ publishedOn: '2026-10-14', dueOn: '2026-11-02', targetMonth: 1, planMonth: '2026-01' }),
        { publishedOn: '2026-10-14', dueOn: '2026-11-02' },
    );
    assert.equal(contentPlanCalendarDates({ publishedOn: 'October 14, 2026', dueOn: '3', targetMonth: 10 }).publishedOn, null);
    const written = normalizeContentPlanDraft(draft({ publishedOn: '2026-10-14', dueOn: '2026-11-02' }));
    assert.equal(written.ok, true);
    if (!written.ok) return;
    assert.equal(written.value.publishedOn, '2026-10-14');
    assert.equal(written.value.dueOn, '2026-11-02');
    assert.equal(normalizeContentPlanDraft(draft({ publishedOn: 'October 2026' })).ok, false);
    assert.equal(normalizeContentPlanDraft(draft({ dueOn: '3' })).ok, false);
    assert.equal(normalizeContentPlanDraft(draft({ title: '' })).ok, false);
});

test('a content row keeps the work month and does not copy roadmap or plan fields', () => {
    const written = normalizeContentPlanDraft(draft({
        status: 'in_review',
        keyword: 'emergency dentist',
        draftUrl: 'https://docs.example/draft',
    }));
    assert.equal(written.ok, true);
    if (!written.ok) return;
    const inserted = contentPlanInsertRow({ organizationId: 'org', clientId: 'client' }, '2026-10', written.value);
    assert.equal(inserted.plan_month, '2026-10');
    assert.equal(inserted.search_volume, null);
    assert.equal(inserted.keyword_difficulty, null);
    assert.equal(inserted.keyword, 'emergency dentist');
    assert.equal(inserted.draft_url, 'https://docs.example/draft');
    assert.equal('target_month' in inserted, false);
    assert.equal('initiative_id' in inserted, false);
    assert.equal('pillar_id' in inserted, false);
    assert.equal('task_id' in inserted, false);
    const updated = contentPlanUpdateRow(written.value);
    assert.equal('plan_month' in updated, false);
    assert.equal('organization_id' in updated, false);
    assert.throws(() => contentPlanInsertRow({ organizationId: 'org', clientId: 'client' }, '3', written.value), /work month/);
    assert.throws(() => contentPlanInsertRow({ organizationId: 'org', clientId: 'client' }, 'October 2026', written.value), /work month/);
    assert.equal(normalizeContentPlanDraft(draft({ draftUrl: 'javascript:alert(1)' })).ok, false);
    assert.equal(normalizeContentPlanDraft(draft({ liveUrl: 'notaurl' })).ok, false);
    assert.equal(normalizeContentPlanDraft(draft({ internalUrl: '/services' })).ok, false);
});

test('content plan sources do not seed the template example or turn a flag on', () => {
    const files = [
        '../../migrations/119_campaign_content_plan.sql',
        '../../components/campaign-workspace/ContentPlanTable.tsx',
        '../../lib/supabase/campaign-content-plan.ts',
        './content-plan.ts',
    ];
    for (const file of files) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8');
        assert.equal(source.includes(EXAMPLE_TITLE), false, file);
        assert.equal(/kitchen remodel/i.test(source), false, file);
        assert.equal(/ahrefs|semrush/i.test(source), false, file);
        assert.equal(source.includes('NEXT_PUBLIC_'), false, file);
    }
    const stage = readFileSync(new URL('../../components/seo-plan/StagePlanListView.tsx', import.meta.url), 'utf8');
    const checklist = readFileSync(new URL('../../components/marketing-plan/MarketingPlanTab.tsx', import.meta.url), 'utf8');
    const sidebar = readFileSync(new URL('../../components/dashboard/Sidebar.tsx', import.meta.url), 'utf8');
    assert.match(stage, /notifyOverviewMonth\(month\)/);
    assert.match(checklist, /notifyOverviewMonth\(month\)/);
    assert.equal(sidebar.includes('Content Plan'), false);
    const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    assert.match(envExample, /^NEXT_PUBLIC_CAMPAIGN_WORKSPACE=$/m);
    assert.match(envExample, /^NEXT_PUBLIC_KEYWORD_TRACKING=$/m);
    assert.equal(envExample.includes('NEXT_PUBLIC_CAMPAIGN_WORKSPACE=true'), false);
    assert.equal(envExample.includes('NEXT_PUBLIC_KEYWORD_TRACKING=true'), false);
});
