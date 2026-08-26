import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityPicker } from '../../components/timesheets/ActivityPicker.tsx';
import { ImportRow } from '../../components/timesheets/ImportRow.tsx';
import {
    ImportReviewQueue,
    type QueuePayload,
} from '../../components/timesheets/ImportReviewView.tsx';
import {
    buildActivityEdit,
    buildSuggestionEdit,
    createInFlightRequestCache,
    createLatestRequestSequencer,
    currentRequestItems,
    draftForRow,
    normalizeImportDraft,
    planBulkClientEdits,
    settleOperations,
    withRunningState,
} from './import-review-ui.ts';
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

const internalRow: QueueRow = {
    ...readyRow,
    id: 'entry-internal',
    clientId: 'stale-client',
    clientName: null,
    isInternal: true,
    countsTowardBudget: true,
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

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
    const draft = { ...draftForRow(readyRow), detail: 'crawl review' };
    assert.deepEqual(buildActivityEdit(readyRow, draft, 'technical_audit'), {
        activityKey: 'technical_audit',
        detail: 'crawl review',
        clientId: 'client-1',
        countsTowardBudget: true,
    });
    assert.deepEqual(buildActivityEdit(readyRow, draft, 'internal_admin'), {
        activityKey: 'internal_admin',
        detail: 'crawl review',
        clientId: 'client-1',
        countsTowardBudget: false,
    });
});

test('a detail-only suggestion preserves an explicit budget override', () => {
    const draft = {
        ...draftForRow(readyRow),
        countsTowardBudget: false,
    };

    assert.deepEqual(buildSuggestionEdit(readyRow, draft, {
        title: 'Review crawl findings',
        taskId: 'task-1',
        activityKey: null,
    }), {
        activityKey: 'technical_audit',
        detail: 'Review crawl findings',
        clientId: 'client-1',
        countsTowardBudget: false,
    });
});

test('a suggestion changes the budget default only when it changes activity', () => {
    const draft = {
        ...draftForRow(readyRow),
        countsTowardBudget: false,
    };

    assert.equal(buildSuggestionEdit(readyRow, draft, {
        title: 'Same audit', taskId: null, activityKey: 'technical_audit',
    })?.countsTowardBudget, false);
    assert.equal(buildSuggestionEdit(readyRow, draft, {
        title: 'Write blog', taskId: null, activityKey: 'blog_post',
    })?.countsTowardBudget, true);
});

test('internal drafts and edits always clear client and budget values', () => {
    const draft = draftForRow(internalRow);
    assert.equal(draft.clientId, null);
    assert.equal(draft.countsTowardBudget, false);
    assert.deepEqual(normalizeImportDraft(internalRow, {
        ...draft,
        clientId: 'client-2',
        countsTowardBudget: true,
    }), {
        ...draft,
        clientId: null,
        countsTowardBudget: false,
    });
    assert.deepEqual(buildActivityEdit(internalRow, draft, 'technical_audit'), {
        activityKey: 'technical_audit',
        detail: '',
        clientId: null,
        countsTowardBudget: false,
    });
});

test('bulk client plans exclude internal rows and report the affected count', () => {
    const plan = planBulkClientEdits(
        [readyRow, internalRow],
        new Set([readyRow.id, internalRow.id]),
        'client-2',
    );

    assert.equal(plan.affectedCount, 1);
    assert.equal(plan.excludedInternalCount, 1);
    assert.equal(plan.invalidActivityCount, 0);
    assert.deepEqual(plan.edits, [{
        id: readyRow.id,
        edit: {
            activityKey: 'technical_audit',
            detail: '',
            clientId: 'client-2',
            countsTowardBudget: true,
        },
    }]);
});

test('suggestion cache deduplicates only in-flight requests and retries failures', async () => {
    const cache = createInFlightRequestCache<string>();
    const first = deferred<string>();
    let loads = 0;
    const loadFirst = () => {
        loads += 1;
        return first.promise;
    };

    const one = cache.get('same-key', loadFirst);
    const two = cache.get('same-key', loadFirst);
    assert.equal(loads, 1);
    first.resolve('first');
    assert.deepEqual(await Promise.all([one, two]), ['first', 'first']);

    assert.equal(await cache.get('same-key', async () => {
        loads += 1;
        return 'second';
    }), 'second');
    await assert.rejects(cache.get('failed-key', async () => {
        loads += 1;
        throw new Error('temporary');
    }), /temporary/);
    assert.equal(await cache.get('failed-key', async () => {
        loads += 1;
        return 'recovered';
    }), 'recovered');
    assert.equal(loads, 4);
});

test('suggestions from a previous request key are hidden immediately', () => {
    const result = { requestKey: 'client-1', items: ['first suggestion'] };

    assert.deepEqual(currentRequestItems(result, 'client-1'), ['first suggestion']);
    assert.deepEqual(currentRequestItems(result, 'client-2'), []);
});

test('bulk settlements wait for every request before reporting failures', async () => {
    const slow = deferred<void>();
    const summaryPromise = settleOperations([
        async () => { throw new Error('first failed'); },
        () => slow.promise,
    ]);
    let settled = false;
    void summaryPromise.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);

    slow.resolve();
    const summary = await summaryPromise;
    assert.equal(summary.succeededCount, 1);
    assert.equal(summary.failedCount, 1);
    assert.match(summary.errors[0].message, /first failed/);
});

test('latest request sequencing ignores an older response that finishes last', async () => {
    const sequencer = createLatestRequestSequencer<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    const applied: string[] = [];

    const older = sequencer.run(() => first.promise, value => applied.push(value));
    const newer = sequencer.run(() => second.promise, value => applied.push(value));
    second.resolve('newer');
    assert.equal(await newer, true);
    first.resolve('older');
    assert.equal(await older, false);
    assert.deepEqual(applied, ['newer']);
});

test('latest request sequencing suppresses stale failures', async () => {
    const sequencer = createLatestRequestSequencer<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    const older = sequencer.run(() => first.promise, () => undefined);
    const newer = sequencer.run(() => second.promise, () => undefined);

    second.resolve('newer');
    assert.equal(await newer, true);
    first.reject(new Error('stale failure'));
    assert.equal(await older, false);
});

test('tracked async work stays busy until its authoritative reload finishes', async () => {
    const reload = deferred<void>();
    const runningStates: boolean[] = [];
    let importFinished = false;

    const work = withRunningState(
        running => runningStates.push(running),
        async () => {
            importFinished = true;
            await reload.promise;
        },
    );

    assert.equal(importFinished, true);
    assert.deepEqual(runningStates, [true]);
    reload.resolve();
    await work;
    assert.deepEqual(runningStates, [true, false]);
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

test('the bulk client control tells managers how many external rows it will update', () => {
    const html = renderToStaticMarkup(createElement(ImportReviewQueue, {
        organizationId: 'org-1',
        payload: payload([readyRow, internalRow], true),
        clients: [],
        selected: new Set([readyRow.id, internalRow.id]),
        isBusy: false,
        error: null,
        backfillMembers: [],
        onReload: async () => undefined,
        onToggle: () => undefined,
        onClearSelection: () => undefined,
        onEdit: () => undefined,
        onBulkClient: () => undefined,
        onApprove: () => undefined,
        onBounce: () => undefined,
        onSubmit: () => undefined,
    }));

    assert.match(html, /1 will be updated/);
    assert.match(html, /1 internal excluded/);
});
