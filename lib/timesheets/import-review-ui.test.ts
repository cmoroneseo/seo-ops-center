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
    budgetChoicePatch,
    buildActivityEdit,
    buildImportEdit,
    buildSuggestionEdit,
    createInFlightRequestCache,
    createLatestRequestSequencer,
    currentRequestItems,
    addReferenceLinkPatch,
    draftForRow,
    normalizeImportDraft,
    removeReferenceLinkPatch,
    planBulkClientEdits,
    taskLinkPatch,
    importEditForPatch,
    taskNotesFromDraft,
    activityTitle,
    taskTitleFromDraft,
    taskUnlinkPatch,
    settleOperations,
    withRunningState,
} from './import-review-ui.ts';
import type { QueueRow } from './import-queue-route.ts';
import { TIMESHEET_ACTIVITIES, describeActivity } from './activities.ts';

const readyRow: QueueRow = {
    id: 'entry-ready',
    userId: 'user-1',
    clientId: 'client-1',
    clientName: 'Acme',
    isInternal: false,
    activityKeys: ['technical_audit'],
    referenceLinks: [],
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
    activityKeys: [],
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
        value: [],
        onChange: () => undefined,
        defaultOpen: true,
    }));

    assert.match(html, /What was this\?/);
    // Grouped by category, and every choice is a real checkbox — a native
    // <select multiple> would demand shift-clicking and show no affordance.
    assert.match(html, /Technical SEO</);
    assert.match(html, /Technical SEO Audit</);
    assert.match(html, /Non-billable to budget</);
    assert.match(html, /Internal Admin</);
    assert.doesNotMatch(html, /<select/);
    assert.doesNotMatch(html, /multiple/);
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, TIMESHEET_ACTIVITIES.length);
});

test('the closed picker still reads out every selected activity on the row', () => {
    const keys = ['gbp_optimization', 'keyword_research', 'content_strategy'];
    const html = renderToStaticMarkup(createElement(ActivityPicker, {
        id: 'activity-entry-ready',
        value: keys,
        onChange: () => undefined,
    }));

    // A manager scanning the queue reads the tags without opening anything.
    const summary = describeActivity(keys, '');
    assert.ok(summary.includes(','), 'expected a multi-activity summary');
    assert.match(html, new RegExp(summary.replace(/&/g, '&amp;')));
    assert.match(html, /aria-expanded="false"/);
    // Tailwind semantic tokens only — no hard-coded colors.
    assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/);
});

test('a first activity choice seeds the budget default', () => {
    // blockedRow carries no activities, so nobody has decided budget yet.
    const draft = { ...draftForRow(blockedRow), detail: 'crawl review' };
    assert.equal(draft.budgetIsExplicit, false);

    assert.deepEqual(buildActivityEdit(blockedRow, draft, ['technical_audit']), {
        activityKeys: ['technical_audit'],
        referenceLinks: [],
        detail: 'crawl review',
        clientId: 'client-1',
        countsTowardBudget: true,
    });
    assert.deepEqual(buildActivityEdit(blockedRow, draft, ['internal_admin']), {
        activityKeys: ['internal_admin'],
        referenceLinks: [],
        detail: 'crawl review',
        clientId: 'client-1',
        countsTowardBudget: false,
    });
});

test('a block carries several activities without splitting its hours', () => {
    const draft = draftForRow(blockedRow);
    const keys = ['gbp_optimization', 'keyword_research', 'content_strategy'];
    const edit = buildActivityEdit(blockedRow, draft, keys);

    assert.deepEqual(edit?.activityKeys, keys);
    // Nothing in the edit touches hours: tagging is not splitting.
    assert.deepEqual(Object.keys(edit ?? {}).sort(), [
        'activityKeys', 'clientId', 'countsTowardBudget', 'detail', 'referenceLinks',
    ]);
});

test('clearing every activity yields no edit at all', () => {
    assert.equal(buildActivityEdit(readyRow, draftForRow(readyRow), []), null);
    assert.equal(buildImportEdit(blockedRow, draftForRow(blockedRow)), null);
});

test('an explicit budget choice survives any later activity change', () => {
    // Turn budget OFF on a delivery activity that would default it ON.
    const decided = {
        ...draftForRow(blockedRow),
        ...budgetChoicePatch(false),
        activityKeys: ['technical_audit'],
    };
    assert.equal(decided.budgetIsExplicit, true);
    assert.equal(
        buildActivityEdit(blockedRow, decided, ['blog_post'])?.countsTowardBudget,
        false,
    );

    // And the same in the other direction: budget ON stays ON even when every
    // newly chosen activity would default it OFF. Account Management & Comms
    // billed for two clients and not for two others in the reviewed data —
    // the activity simply does not decide this.
    const billed = {
        ...draftForRow(blockedRow),
        ...budgetChoicePatch(true),
        activityKeys: ['technical_audit'],
    };
    assert.equal(
        buildActivityEdit(blockedRow, billed, ['account_management', 'internal_admin'])
            ?.countsTowardBudget,
        true,
    );

    // A row that already went through review carries a decision, not a guess.
    const reviewed = draftForRow(readyRow);
    assert.equal(reviewed.budgetIsExplicit, true);
});

test('a detail-only suggestion preserves an explicit budget override', () => {
    const draft = {
        ...draftForRow(readyRow),
        countsTowardBudget: false,
    };

    assert.deepEqual(buildSuggestionEdit(readyRow, draft, {
        title: 'Review crawl findings',
        taskId: 'task-1',
        activityKeys: [],
    }), {
        activityKeys: ['technical_audit'],
        referenceLinks: [],
        detail: 'Review crawl findings',
        clientId: 'client-1',
        countsTowardBudget: false,
    });
});

test('a suggestion seeds the budget default only while none was chosen', () => {
    const undecided = draftForRow(blockedRow);
    assert.equal(buildSuggestionEdit(blockedRow, undecided, {
        title: 'Write blog', taskId: null, activityKeys: ['blog_post'],
    })?.countsTowardBudget, true);
    assert.equal(buildSuggestionEdit(blockedRow, undecided, {
        title: 'Team sync', taskId: null, activityKeys: ['internal_admin'],
    })?.countsTowardBudget, false);

    // Once a person has decided, a suggestion may retag but never re-bill.
    const decided = { ...undecided, ...budgetChoicePatch(false) };
    assert.equal(buildSuggestionEdit(blockedRow, decided, {
        title: 'Write blog', taskId: null, activityKeys: ['blog_post'],
    })?.countsTowardBudget, false);
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
    assert.deepEqual(buildActivityEdit(internalRow, draft, ['technical_audit']), {
        activityKeys: ['technical_audit'],
        referenceLinks: [],
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
            activityKeys: ['technical_audit'],
            referenceLinks: [],
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

// --- reference links -------------------------------------------------------

const linkedRow: QueueRow = {
    ...readyRow,
    id: 'entry-linked',
    referenceLinks: [{
        label: 'All In One Construction - 6-Month SEO Roadmap',
        url: 'https://docs.google.com/document/d/roadmap',
    }],
};

test('existing links render as chips that open in a new tab', () => {
    const html = renderToStaticMarkup(createElement(ImportRow, {
        row: linkedRow,
        clients: [],
        organizationId: 'org-1',
        isSelected: false,
        isManager: false,
        isBusy: false,
        onToggleSelect: () => undefined,
        onEdit: () => undefined,
        onApprove: () => undefined,
        onBounce: () => undefined,
    }));

    assert.match(html, /All In One Construction - 6-Month SEO Roadmap/);
    assert.match(html, /href="https:\/\/docs\.google\.com\/document\/d\/roadmap"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    // Removable, labelled, and an affordance to add another.
    assert.match(html, /aria-label="Remove All In One Construction - 6-Month SEO Roadmap"/);
    assert.match(html, />Add link</);
    // Tailwind semantic tokens only — no hard-coded colors.
    assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/);
});

test('a draft carries the row\'s links into every edit it builds', () => {
    const draft = draftForRow(linkedRow);
    assert.deepEqual(draft.referenceLinks, linkedRow.referenceLinks);
    assert.deepEqual(
        buildImportEdit(linkedRow, draft)?.referenceLinks,
        linkedRow.referenceLinks,
    );
});

test('adding a link patches the draft; a rejected URL patches nothing', () => {
    const draft = draftForRow(readyRow);

    const added = addReferenceLinkPatch(draft, '  Roadmap  ', '  https://example.com/doc  ');
    assert.equal(added.ok, true);
    assert.deepEqual(added.ok && added.patch.referenceLinks, [
        { label: 'Roadmap', url: 'https://example.com/doc' },
    ]);

    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', '//evil.com', 'nope']) {
        const rejected = addReferenceLinkPatch(draft, 'click', url);
        assert.equal(rejected.ok, false, `expected rejection: ${url}`);
        assert.equal('patch' in rejected, false);
    }

    assert.equal(addReferenceLinkPatch(draft, '   ', 'https://example.com').ok, false);
});

test('the same link is never added twice, and ten is the ceiling', () => {
    const draft = draftForRow(linkedRow);
    const duplicate = addReferenceLinkPatch(draft, 'Same doc', linkedRow.referenceLinks[0].url);
    assert.equal(duplicate.ok, false);

    const full = {
        ...draft,
        referenceLinks: Array.from({ length: 10 }, (_, index) => ({
            label: `Doc ${index}`,
            url: `https://example.com/${index}`,
        })),
    };
    const overflow = addReferenceLinkPatch(full, 'One more', 'https://example.com/extra');
    assert.equal(overflow.ok, false);
    assert.match(!overflow.ok ? overflow.error : '', /at most 10 links/);
});

test('removing a chip removes exactly that link', () => {
    const draft = {
        ...draftForRow(readyRow),
        referenceLinks: [
            { label: 'A', url: 'https://example.com/a' },
            { label: 'B', url: 'https://example.com/b' },
            { label: 'C', url: 'https://example.com/c' },
        ],
    };
    assert.deepEqual(removeReferenceLinkPatch(draft, 1).referenceLinks, [
        { label: 'A', url: 'https://example.com/a' },
        { label: 'C', url: 'https://example.com/c' },
    ]);
});

// --- task links ------------------------------------------------------------

const taskLinkedRow: QueueRow = {
    ...readyRow,
    id: 'entry-task-linked',
    taskId: 'task-roadmap',
    taskTitle: 'Add roadmap to-dos to Basecamp',
    issues: [],
};

function renderRow(row: QueueRow) {
    return renderToStaticMarkup(createElement(ImportRow, {
        row,
        clients: [],
        organizationId: 'org-1',
        isSelected: false,
        isManager: false,
        isBusy: false,
        onToggleSelect: () => undefined,
        onEdit: () => undefined,
        onApprove: () => undefined,
        onBounce: () => undefined,
    }));
}

test('a draft carries the row\'s task link and its title', () => {
    const draft = draftForRow(taskLinkedRow);
    assert.equal(draft.taskId, 'task-roadmap');
    assert.equal(draft.taskTitle, 'Add roadmap to-dos to Basecamp');
    // An edit that only retags the block leaves the attribution alone rather
    // than resending — or dropping — a link nobody touched.
    assert.equal('taskId' in (buildImportEdit(taskLinkedRow, draft) ?? {}), false);
});

test('linking and unlinking both reach the patch', () => {
    const draft = draftForRow(readyRow);
    const linked = buildImportEdit(readyRow, draft, taskLinkPatch('task-1', 'Roadmap'));
    assert.equal(linked?.taskId, 'task-1');

    // Clearing is an explicit null, never an omission: the RPC writes what the
    // patch carries, and an omitted key leaves the stored link in place.
    const unlinked = buildImportEdit(
        taskLinkedRow,
        draftForRow(taskLinkedRow),
        taskUnlinkPatch(),
    );
    assert.equal(unlinked?.taskId, null);
});

test('moving a row to another client drops the task it stranded', () => {
    const draft = draftForRow(taskLinkedRow);
    // Billable time attributed to a task on the client it just left is exactly
    // the mis-attribution the RPC guard exists to prevent.
    assert.equal(
        buildImportEdit(taskLinkedRow, draft, { clientId: 'client-2' })?.taskId,
        null,
    );
    // Re-picking the same client is not a move and touches nothing.
    assert.equal(
        'taskId' in (buildImportEdit(taskLinkedRow, draft, { clientId: 'client-1' }) ?? {}),
        false,
    );
});

test('a new task title names the work, and the notes carry the commentary', () => {
    const draft = draftForRow(readyRow);
    // Superseded intent: this used to prefer `detail`, which is why a real
    // Basecamp to-do arrived titled with a paragraph of notes.
    assert.equal(
        taskTitleFromDraft(readyRow, { ...draft, detail: 'Added roadmap To-do\'s to basecamp' }),
        'Technical SEO Audit',
    );
    assert.equal(
        taskNotesFromDraft(readyRow, { ...draft, detail: 'Added roadmap To-do\'s to basecamp' }),
        'Added roadmap To-do\'s to basecamp',
    );
    // With no activities at all, the person's words are the best title left.
    assert.equal(
        taskTitleFromDraft(readyRow, { ...draft, activityKeys: [], detail: 'Ad hoc fix' }),
        'Ad hoc fix',
    );
});

test('a linked row reads out its task and offers a way to unlink', () => {
    const html = renderRow(taskLinkedRow);
    assert.match(html, /Add roadmap to-dos to Basecamp/);
    assert.match(html, /aria-label="Unlink the task from [^"]+"/);
    assert.doesNotMatch(html, />Link task</);
    assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/);
});

test('an unlinked row offers a keyboard-operable picker', () => {
    const html = renderRow(readyRow);
    assert.match(html, />Link task</);
    assert.match(html, /aria-label="Link a task to [^"]+"/);
    assert.match(html, /aria-expanded="false"/);
    // Hand-rolled disclosure, not Radix: nothing is rendered until it opens.
    assert.doesNotMatch(html, /Find a task/);
    assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/);
});

test('a row with no client says so instead of offering an empty list', () => {
    const html = renderRow({ ...readyRow, clientId: null, clientName: null });
    assert.match(html, /Choose a client to link a task/);
    assert.doesNotMatch(html, />Link task</);
});

test('an internal row cannot pick a task either', () => {
    // Internal time has no client by construction, so it has no task set.
    assert.match(renderRow(internalRow), /Choose a client to link a task/);
});

// ── The seam that broke linking ──────────────────────────────────────────────
// `buildImportEdit` reads `patch.taskId`. The row component merged the patch
// into the draft first and then called it WITHOUT the patch, so every link and
// unlink was dropped before it reached the server — while the unit tests above,
// which pass the patch correctly, stayed green. `importEditForPatch` composes
// both steps so that mistake is not available.

test('linking a task through the composed seam actually sends task_id', () => {
    const row = readyRow;
    const { draft, edit } = importEditForPatch(
        row, draftForRow(row), taskLinkPatch('task-1', 'Roadmap'),
    );

    assert.equal(draft.taskId, 'task-1');
    assert.equal(draft.taskTitle, 'Roadmap');
    assert.equal(edit?.taskId, 'task-1', 'the link must reach the server, not just local state');
});

test('unlinking through the composed seam sends an explicit null', () => {
    const row = readyRow;
    const linked = importEditForPatch(row, draftForRow(row), taskLinkPatch('task-1', 'Roadmap')).draft;
    const { draft, edit } = importEditForPatch(row, linked, taskUnlinkPatch());

    assert.equal(draft.taskId, null);
    assert.equal(edit?.taskId, null, 'unlink must be sent, not silently skipped');
});

test('changing the client clears a task link that would strand billable time', () => {
    const row = readyRow;
    const linked = importEditForPatch(row, draftForRow(row), taskLinkPatch('task-1', 'Roadmap')).draft;
    const { edit } = importEditForPatch(row, linked, { clientId: 'another-client' });

    assert.equal(edit?.clientId, 'another-client');
    assert.equal(edit?.taskId, null, 'a task from the old client must not follow the row');
});

test('an unrelated edit leaves an existing task link untouched', () => {
    const row = readyRow;
    const linked = importEditForPatch(row, draftForRow(row), taskLinkPatch('task-1', 'Roadmap')).draft;
    const { edit } = importEditForPatch(row, linked, { detail: 'new note' });

    assert.equal('taskId' in (edit ?? {}), false, 'do not resend a link that did not change');
});

// ── Task title and notes ─────────────────────────────────────────────────────

test('a task is titled by its activities, not by the notes', () => {
    // A real to-do arrived in Basecamp titled "Updated GBP categories, added
    // services with descriptions, added UTM to website URL, created updated
    // SEO roadmap draft" — the commentary, with Notes left empty.
    const row = readyRow;
    const draft = importEditForPatch(row, draftForRow(row), {
        activityKeys: ['keyword_research', 'content_strategy', 'gbp_optimization'],
        detail: 'Updated GBP categories, added services with descriptions',
    }).draft;

    assert.equal(
        taskTitleFromDraft(row, draft),
        'Keyword Research & Strategy + Content Strategy & Calendar + GBP Optimization',
    );
    assert.equal(
        taskNotesFromDraft(row, draft),
        'Updated GBP categories, added services with descriptions',
    );
});

test('the activity title is stable regardless of tick order', () => {
    assert.equal(
        activityTitle(['gbp_optimization', 'keyword_research']),
        activityTitle(['keyword_research', 'gbp_optimization']),
    );
});

test('with no activities the detail is still usable as a title', () => {
    assert.equal(activityTitle([]), '');
});
