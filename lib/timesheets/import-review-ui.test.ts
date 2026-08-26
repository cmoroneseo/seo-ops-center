import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityPicker } from '../../components/timesheets/ActivityPicker.tsx';
import {
    buildActivityEdit,
    ImportRow,
} from '../../components/timesheets/ImportRow.tsx';
import {
    ImportReviewQueue,
    type QueuePayload,
} from '../../components/timesheets/ImportReviewView.tsx';
import type { QueueRow } from './import-queue-route.ts';

const readyRow: QueueRow = {
    id: 'entry-ready',
    userId: 'user-1',
    clientId: 'client-1',
    clientName: 'Acme',
    isInternal: false,
    activityKey: 'technical_audit',
    taskId: null,
    taskTitle: null,
    importStatus: 'needs_context',
    date: '2026-08-25',
    hours: 1.5,
    description: '',
    countsTowardBudget: true,
    basecampProjectName: 'Acme SEO',
    reviewNote: null,
    minutes: 90,
    issues: ['no_task_link'],
    isReady: true,
};

const pendingRow: QueueRow = {
    ...readyRow,
    id: 'entry-pending',
    importStatus: 'pending_review',
};

const blockedRow: QueueRow = {
    ...readyRow,
    id: 'entry-blocked',
    activityKey: null,
    countsTowardBudget: false,
    issues: ['missing_activity', 'no_task_link'],
    isReady: false,
};

function payload(rows: QueueRow[], isManager: boolean): QueuePayload {
    return {
        isManager,
        rows,
        summary: {
            total: rows.length,
            ready: rows.filter(row => row.isReady).length,
            blocked: rows.filter(row => row.importStatus === 'needs_context' && !row.isReady).length,
            pendingReview: rows.filter(row => row.importStatus === 'pending_review').length,
        },
    };
}

test('activity picker exposes grouped delivery and non-budget choices', () => {
    const html = renderToStaticMarkup(createElement(ActivityPicker, {
        id: 'activity-entry-ready',
        value: null,
        onChange: () => undefined,
    }));

    assert.match(html, /What was this\?/);
    assert.match(html, /<optgroup label="Technical SEO">/);
    assert.match(html, /value="technical_audit">Technical SEO Audit/);
    assert.match(html, /<optgroup label="Non-billable to budget">/);
    assert.match(html, /value="internal_admin">Internal Admin/);
});

test('choosing an activity includes its budget default in the edit', () => {
    assert.deepEqual(buildActivityEdit(readyRow, 'crawl review', 'technical_audit'), {
        activityKey: 'technical_audit',
        detail: 'crawl review',
        clientId: 'client-1',
        countsTowardBudget: true,
    });
    assert.deepEqual(buildActivityEdit(readyRow, '', 'internal_admin'), {
        activityKey: 'internal_admin',
        detail: '',
        clientId: 'client-1',
        countsTowardBudget: false,
    });
});

test('pending review controls render for managers and never for members', () => {
    const baseProps = {
        row: pendingRow,
        clients: [],
        organizationId: 'org-1',
        isSelected: false,
        isBusy: false,
        onToggleSelect: () => undefined,
        onEdit: () => undefined,
        onApprove: () => undefined,
        onBounce: () => undefined,
    };
    const memberHtml = renderToStaticMarkup(createElement(ImportRow, {
        ...baseProps,
        isManager: false,
    }));
    const managerHtml = renderToStaticMarkup(createElement(ImportRow, {
        ...baseProps,
        isManager: true,
    }));

    assert.doesNotMatch(memberHtml, />Approve</);
    assert.doesNotMatch(memberHtml, />Send back</);
    assert.match(managerHtml, />Approve</);
    assert.match(managerHtml, />Send back</);
});

test('an empty manager queue keeps backfill visible while members never receive it', () => {
    const props = {
        clients: [],
        selected: new Set<string>(),
        isBusy: false,
        error: null,
        backfillMembers: [{ userId: 'user-1', label: 'Ada', hasBasecampPerson: true }],
        onReload: () => undefined,
        onToggle: () => undefined,
        onClearSelection: () => undefined,
        onEdit: () => undefined,
        onBulkClient: () => undefined,
        onApprove: () => undefined,
        onBounce: () => undefined,
        onSubmit: () => undefined,
    };
    const managerHtml = renderToStaticMarkup(createElement(ImportReviewQueue, {
        ...props,
        organizationId: 'org-1',
        payload: payload([], true),
    }));
    const memberHtml = renderToStaticMarkup(createElement(ImportReviewQueue, {
        ...props,
        organizationId: 'org-1',
        payload: payload([], false),
    }));

    assert.match(managerHtml, /Import from Basecamp/);
    assert.match(managerHtml, /Nothing waiting for review/);
    assert.doesNotMatch(memberHtml, /Import from Basecamp/);
});

test('the queue exposes bulk context, ready and attention counts, and explicit submission', () => {
    const html = renderToStaticMarkup(createElement(ImportReviewQueue, {
        organizationId: 'org-1',
        payload: payload([readyRow, blockedRow], false),
        clients: [],
        selected: new Set([readyRow.id, blockedRow.id]),
        isBusy: false,
        error: null,
        backfillMembers: [],
        onReload: () => undefined,
        onToggle: () => undefined,
        onClearSelection: () => undefined,
        onEdit: () => undefined,
        onBulkClient: () => undefined,
        onApprove: () => undefined,
        onBounce: () => undefined,
        onSubmit: () => undefined,
    }));

    assert.match(html, /2 selected/);
    assert.match(html, /Set client/);
    assert.match(html, /1 of 2 ready/);
    assert.match(html, /1 need attention/);
    assert.match(html, /Submit 1 for review/);
});
