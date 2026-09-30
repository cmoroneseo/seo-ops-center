/**
 * Run with: node --import tsx --test lib/marketing-plan-generate-tasks-panel.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenerateTasksPanel } from '../components/marketing-plan/GenerateTasksPanel.tsx';
import { ItemRow } from '../components/marketing-plan/ItemRow.tsx';
import type { MarketingPlanItem } from './types.ts';

// Next's automatic JSX runtime covers the app build. This runner preserves JSX,
// so the component's compiled createElement calls need React on the global.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

function item(over: Partial<MarketingPlanItem>): MarketingPlanItem {
    return {
        id: 'i1', marketingPlanId: 'p1', organizationId: 'o1', clientId: 'c1',
        stepKey: 'technical', title: 'Fix title tags', status: 'todo', priority: 'high',
        sortOrder: 0, comments: [], isCustom: false,
        createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z',
        ...over,
    };
}

test('generate-tasks panel lists eligible items and the create count', () => {
    const html = renderToStaticMarkup(createElement(GenerateTasksPanel, {
        scopeLabel: 'Technical SEO',
        items: [
            item({ id: 'a', title: 'Fix title tags' }),
            item({ id: 'b', title: 'Add canonicals', priority: 'medium' }),
        ],
        creating: false,
        onConfirm: () => {},
        onClose: () => {},
    }));
    assert.match(html, /Create tasks — Technical SEO/);
    assert.match(html, /Fix title tags/);
    assert.match(html, /Add canonicals/);
    assert.match(html, /Create 2 tasks/);
    assert.match(html, /High/);
});

test('item row shows a task chip only after the item is linked', () => {
    const unlinked = renderToStaticMarkup(createElement(ItemRow, {
        item: item({ id: 'a', title: 'Claim the profile' }),
        members: [],
        currentUser: { name: 'Carlos' },
        onChanged: () => {},
    }));
    assert.match(unlinked, /Claim the profile/);
    assert.doesNotMatch(unlinked, /\/tasks\?task=/);

    const linked = renderToStaticMarkup(createElement(ItemRow, {
        item: item({ id: 'b', title: 'Claim the profile', taskId: 'task-1', status: 'done' }),
        members: [],
        currentUser: { name: 'Carlos' },
        onChanged: () => {},
    }));
    assert.match(linked, /href="\/tasks\?task=task-1"/);
    assert.doesNotMatch(linked, /type="checkbox"/);
    assert.match(linked, /Open task/);
});
