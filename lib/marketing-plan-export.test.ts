/**
 * Run with:  node --test lib/marketing-plan-export.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketingPlanExportHtml } from './marketing-plan-export.ts';
import type { MarketingPlan, MarketingPlanItem } from './types.ts';

function item(over: Partial<MarketingPlanItem>): MarketingPlanItem {
    return {
        id: 'i1', marketingPlanId: 'p1', organizationId: 'o1', clientId: 'c1',
        stepKey: 'setup', title: 'Item', status: 'todo', priority: 'medium',
        sortOrder: 0, comments: [], isCustom: false,
        createdAt: '2026-07-16T00:00:00Z', updatedAt: '2026-07-16T00:00:00Z',
        ...over,
    };
}

function plan(items: MarketingPlanItem[]): MarketingPlan {
    return {
        id: 'p1', organizationId: 'o1', clientId: 'c1', title: 'Plan',
        steps: [
            { key: 'setup', name: 'Introduction & Setup', sortOrder: 0 },
            { key: 'technical', name: 'Technical SEO', sortOrder: 1 },
        ],
        createdAt: '2026-07-16T00:00:00Z', updatedAt: '2026-07-16T00:00:00Z',
        items,
    };
}

test('excludes ignored items', () => {
    const html = buildMarketingPlanExportHtml({
        plan: plan([
            item({ id: 'a', title: 'Visible item' }),
            item({ id: 'b', title: 'Hidden ignored item', status: 'ignored' }),
        ]),
        clientName: 'Looda House Pawn',
    });
    assert.ok(html.includes('Visible item'));
    assert.ok(!html.includes('Hidden ignored item'));
});

test('includes comments as notes', () => {
    const html = buildMarketingPlanExportHtml({
        plan: plan([
            item({ comments: [{ authorName: 'Abel Miranda', body: 'Access granted on Monday', createdAt: '2026-07-10T00:00:00Z' }] }),
        ]),
        clientName: 'Client',
    });
    assert.ok(html.includes('Abel Miranda'));
    assert.ok(html.includes('Access granted on Monday'));
    assert.ok(html.includes('Notes'));
});

test('renders markdown links and escapes HTML in user content', () => {
    const html = buildMarketingPlanExportHtml({
        plan: plan([
            item({
                title: 'Title with <script>alert(1)</script>',
                description: 'See [help guide](https://example.com/guide) for setup.',
            }),
        ]),
        clientName: 'Client',
    });
    assert.ok(html.includes('<a href="https://example.com/guide">help guide</a>'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
});

test('skips empty steps and omits internal meta (priority/assignee/due/progress)', () => {
    const html = buildMarketingPlanExportHtml({
        plan: plan([item({ priority: 'high', assigneeId: 'u1', dueDate: '2026-08-01' })]),
        clientName: 'Client',
    });
    assert.ok(!html.includes('Technical SEO'));
    assert.ok(!html.includes('High'));
    assert.ok(!html.includes('Due 2026-08-01'));
    assert.ok(!html.includes('complete'));
});
