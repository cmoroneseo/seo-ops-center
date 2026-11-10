import test from 'node:test';
import assert from 'node:assert/strict';

import type { TopicalMapRecord } from '../types.ts';
import { rowToRecord } from '../supabase/topical-map.ts';
import { manualInsertRow } from './spec.ts';
import {
    approveRecordPatch,
    displayedProductionStatus,
    draftAfterProductionSave,
    emptyProduction,
    productionChoicePatch,
    productionFromRow,
    productionToRow,
    productionUpdates,
    PRODUCTION_STATUS_LABEL,
    PRODUCTION_STATUSES,
    readHttpUrl,
    readProductionStatus,
    readWorkMonth,
    workMonthLabel,
} from './production.ts';
import { MISSING_PRODUCTION_COLUMN, recordUpdateError } from '../supabase/topical-map.ts';

function baseRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'r-1', silo_id: 's-1', map_id: 'm-1', organization_id: 'o-1',
        page_type: 'blog_post', action: 'create', title: 'Marketing ROI', target_query: '',
        word_count_min: 0, word_count_max: 0, build_phase: 1, status: 'pending', sort_order: 0,
        scope_exclusions: [], outgoing_links: [], created_at: '', updated_at: '',
        ...extra,
    };
}

test('every production status and page kind has plain-English copy', () => {
    const labels = new Set<string>();
    for (const status of PRODUCTION_STATUSES) {
        const label = PRODUCTION_STATUS_LABEL[status];
        assert.equal(label.includes('_'), false, status);
        assert.notEqual(label, status);
        assert.equal(labels.has(label), false, label);
        labels.add(label);
    }
    assert.equal(PRODUCTION_STATUS_LABEL.not_written, 'Not written yet');
    assert.equal(PRODUCTION_STATUS_LABEL.awaiting_approval, 'Waiting for approval');
    assert.equal(PRODUCTION_STATUS_LABEL.writing, 'Being written');
    assert.equal(PRODUCTION_STATUS_LABEL.client_review, 'With client for review');
    assert.equal(PRODUCTION_STATUS_LABEL.ready, 'Ready to publish');
    assert.equal(PRODUCTION_STATUS_LABEL.published, 'Published');
    assert.equal(PRODUCTION_STATUS_LABEL.already_live, 'Already on the site');
});

test('a row without the new columns reads as unset and does not throw', () => {
    const fromRow = productionFromRow(baseRow());
    assert.deepEqual(fromRow, emptyProduction());
    const mapped = rowToRecord(baseRow());
    assert.equal(mapped.productionStatus, null);
    assert.equal(mapped.workMonth, null);
    assert.equal(mapped.dueDate, null);
    assert.equal(mapped.publishedOn, null);
    assert.equal(mapped.draftUrl, null);
    assert.equal(mapped.liveUrl, null);
    assert.equal(mapped.status, 'pending');
    assert.equal(displayedProductionStatus(mapped), 'not_written');
});

test('mapper round-trip keeps the stored columns and does not invent dates from the month', () => {
    const stored = productionToRow({
        productionStatus: 'writing',
        workMonth: '2026-11',
        dueDate: '2026-11-02',
        publishedOn: null,
        draftUrl: 'https://docs.example/draft',
        liveUrl: null,
    });
    assert.equal(stored.work_month, '2026-11');
    assert.equal(stored.due_date, '2026-11-02');
    assert.equal(stored.published_on, null);
    const read = productionFromRow(stored);
    assert.deepEqual(read, {
        productionStatus: 'writing',
        workMonth: '2026-11',
        dueDate: '2026-11-02',
        publishedOn: null,
        draftUrl: 'https://docs.example/draft',
        liveUrl: null,
    });
    const mapped = rowToRecord(baseRow({ ...stored, status: 'approved', action: 'create' }));
    assert.equal(mapped.productionStatus, 'writing');
    assert.equal(mapped.dueDate, '2026-11-02');
    assert.equal(mapped.publishedOn, null);
    const written = productionUpdates(mapped);
    assert.equal(written.ok, true);
    if (!written.ok) return;
    assert.equal(written.row.production_status, 'writing');
    assert.equal(written.row.work_month, '2026-11');
    assert.equal(written.row.due_date, '2026-11-02');
    assert.equal(written.row.published_on, null);
    assert.equal(written.row.draft_url, 'https://docs.example/draft');
    assert.equal('content_type' in written.row, false);

    const monthOnly = productionFromRow({ work_month: '2026-11', target_month: 3, plan_month: '2026-01' });
    assert.equal(monthOnly.workMonth, '2026-11');
    assert.equal(monthOnly.dueDate, null);
    assert.equal(monthOnly.publishedOn, null);
    assert.equal(workMonthLabel('2026-11'), 'November 2026');
    assert.equal(workMonthLabel('November 2026'), null);
    assert.equal(readWorkMonth('3'), null);
});

test('displayed status comes from production, plan approval, and a kept match', () => {
    const record = (overrides: Partial<TopicalMapRecord>): TopicalMapRecord => rowToRecord(baseRow(overrides));
    assert.equal(displayedProductionStatus(record({ status: 'pending' })), 'not_written');
    assert.equal(displayedProductionStatus(record({ status: 'approved' })), 'approved');
    assert.equal(displayedProductionStatus(record({ status: 'declined' })), 'declined');
    assert.equal(displayedProductionStatus(record({ status: 'pending', production_status: 'client_review' })), 'client_review');
    assert.equal(displayedProductionStatus(record({
        status: 'pending', action: 'keep', matched_url: 'https://example.com/roi',
    })), 'already_live');
    assert.equal(displayedProductionStatus(record({
        status: 'pending', action: 'keep', matched_url: 'https://example.com/roi', production_status: 'writing',
    })), 'writing');
    assert.equal(displayedProductionStatus(record({
        status: 'approved', action: 'improve', matched_url: 'https://example.com/roi', production_status: 'already_live',
    })), 'approved');
    assert.equal(displayedProductionStatus(record({
        action: 'keep', production_status: 'already_live',
    })), 'not_written');
    assert.equal(displayedProductionStatus(record({ production_status: 'Published' })), 'not_written');
    assert.equal(displayedProductionStatus(record({ production_status: 'published' })), 'published');
});

test('unknown labels and unsafe links read as unset and are rejected on write', () => {
    assert.equal(readProductionStatus('Published'), null);
    assert.equal(readProductionStatus('idea'), null);
    assert.equal(readProductionStatus(null), null);
    assert.equal(readHttpUrl('javascript:alert(1)'), null);
    assert.equal(readHttpUrl('/services'), null);
    assert.equal(readHttpUrl(''), null);
    assert.equal(readHttpUrl('https://docs.example/draft'), 'https://docs.example/draft');

    const plan = productionUpdates({ status: 'approved', taskId: 'task-1' });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.row, {});

    const badLink = productionUpdates({ draftUrl: 'javascript:alert(1)' });
    assert.equal(badLink.ok, false);
    const badMonth = productionUpdates({ workMonth: 'November 2026' });
    assert.equal(badMonth.ok, false);
    const badDate = productionUpdates({ dueDate: '2026-02-31', publishedOn: '2026-11-02' });
    assert.equal(badDate.ok, false);
    const cleared = productionUpdates({
        productionStatus: null,
        workMonth: '',
        dueDate: '',
        publishedOn: '2026-11-02',
        draftUrl: '',
        liveUrl: 'https://example.com/live',
    });
    assert.equal(cleared.ok, true);
    if (!cleared.ok) return;
    assert.equal(cleared.row.production_status, null);
    assert.equal(cleared.row.work_month, null);
    assert.equal(cleared.row.due_date, null);
    assert.equal(cleared.row.published_on, '2026-11-02');
    assert.equal(cleared.row.draft_url, null);
    assert.equal(cleared.row.live_url, 'https://example.com/live');
    assert.equal(cleared.value.dueDate, null);
    assert.equal(cleared.value.publishedOn, '2026-11-02');

    const inserted = manualInsertRow({
        title: 'Marketing ROI', targetQuery: 'marketing roi', pageType: 'blog_post',
        wordCountMin: null, wordCountMax: null, answerFirst60: null, uniqueAngle: null,
        scheduledFor: null, specStatus: null, scopeExclusions: [], outgoingLinks: [],
    }, { siloId: 's-1', mapId: 'm-1', organizationId: 'o-1', sortOrder: 0 });
    assert.equal('production_status' in inserted, false);
    assert.equal('work_month' in inserted, false);
    assert.equal('draft_url' in inserted, false);
    assert.equal('content_type' in inserted, false);
});

test('approve, decline, and the status list stay on one visible status', () => {
    for (const current of [null, undefined, 'not_written' as const, 'awaiting_approval' as const]) {
        const approved = approveRecordPatch('task-1', current);
        assert.equal(approved.status, 'approved');
        assert.equal(approved.taskId, 'task-1');
        assert.equal(approved.productionStatus, 'approved');
    }
    const writing = approveRecordPatch('task-1', 'writing');
    assert.equal(writing.productionStatus, undefined);
    assert.equal(writing.status, 'approved');

    assert.deepEqual(productionChoicePatch('declined'), { productionStatus: 'declined', status: 'declined' });
    assert.deepEqual(productionChoicePatch('not_written'), { productionStatus: 'not_written', status: 'pending' });
    assert.deepEqual(productionChoicePatch('awaiting_approval'), { productionStatus: 'awaiting_approval', status: 'pending' });
    for (const status of ['approved', 'writing', 'client_review', 'ready', 'published', 'already_live', 'failed'] as const) {
        assert.deepEqual(productionChoicePatch(status), { productionStatus: status, status: 'approved' });
    }
});

test('a failed production save puts the drawer back, and a missing column is plain language', () => {
    assert.equal(draftAfterProductionSave('Not written yet', 'Being written', true), 'Being written');
    assert.equal(draftAfterProductionSave('Not written yet', 'Being written', false), 'Not written yet');
    assert.equal(recordUpdateError({ code: '42703', message: 'column production_status does not exist' }, true), MISSING_PRODUCTION_COLUMN);
    assert.equal(recordUpdateError({ code: 'PGRST204', message: 'schema cache' }, true), MISSING_PRODUCTION_COLUMN);
    assert.equal(recordUpdateError({ code: '42703', message: 'column missing' }, false), 'column missing');
    assert.equal(recordUpdateError({ code: '23514', message: 'check failed' }, true), 'check failed');
});
