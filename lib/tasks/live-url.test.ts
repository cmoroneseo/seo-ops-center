import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLedger, type LedgerSource } from '@/lib/search-reporting/ledger';
import { stageAddTitlesError } from '@/lib/seo-plan/stage-add-lines';
import {
    completedAtForLiveUrl,
    splitLiveUrl,
    subtaskLinesError,
    taskToLedgerDeliverable,
} from './live-url.ts';

const NOW = '2026-10-17T01:30:00.000Z';

test('a URL is parsed from a subtask line', () => {
    assert.deepEqual(splitLiveUrl('Chino service page https://example.com/chino'), {
        title: 'Chino service page',
        publishedUrl: 'https://example.com/chino',
    });
    assert.deepEqual(splitLiveUrl('  Title   https://www.example.com/chino-hills/  '), {
        title: 'Title',
        publishedUrl: 'https://www.example.com/chino-hills/',
    });
    assert.deepEqual(splitLiveUrl('https://example.com/chino-hills'), {
        title: 'chino hills',
        publishedUrl: 'https://example.com/chino-hills',
    });
    assert.deepEqual(splitLiveUrl('See (https://example.com/a).'), {
        title: 'See',
        publishedUrl: 'https://example.com/a',
    });
    assert.deepEqual(splitLiveUrl('Review robots.txt'), {
        title: 'Review robots.txt',
        publishedUrl: null,
    });
    assert.deepEqual(splitLiveUrl('javascript:alert(1)'), {
        title: 'javascript:alert(1)',
        publishedUrl: null,
    });
    assert.deepEqual(splitLiveUrl('nothttps://example.com/chino'), {
        title: 'nothttps://example.com/chino',
        publishedUrl: null,
    });
    assert.deepEqual(splitLiveUrl('javascript:https://example.com/chino'), {
        title: 'javascript:https://example.com/chino',
        publishedUrl: null,
    });

    const longUrl = `https://example.com/${'a'.repeat(400)}`;
    const line = `City page ${longUrl}`;
    assert.equal(line.length > 300, true);
    assert.equal(subtaskLinesError([line], stageAddTitlesError), null);
    assert.equal(splitLiveUrl(line).title, 'City page');
    assert.equal(splitLiveUrl(line).publishedUrl, longUrl);
});

test('a completed subtask with a live URL appears in the results ledger', () => {
    const parent = taskToLedgerDeliverable({
        id: 'parent',
        title: 'Publish Approved SEO Content',
        status: 'done',
        category: 'content',
        completedAt: NOW,
    });
    const piece = taskToLedgerDeliverable({
        id: 'piece',
        title: 'Chino service page',
        status: 'done',
        category: 'content',
        publishedUrl: 'https://example.com/chino',
        completedAt: NOW,
    });
    const open = taskToLedgerDeliverable({
        id: 'open',
        title: 'Draft page',
        status: 'todo',
        category: 'content',
        publishedUrl: 'https://example.com/draft',
    });
    assert.equal(parent, null);
    assert.equal(open, null);
    assert.ok(piece);
    assert.equal(piece?.deliveredOn, '2026-10-17');
    assert.equal(piece?.type, 'Content');
    assert.equal(piece?.status, 'Published');

    const model = buildLedger(source([piece!]), new Date('2026-10-17T18:00:00.000Z'));
    assert.equal(model.entries.length, 1);
    assert.equal(model.entries[0].id, 'piece');
    assert.equal(model.entries[0].title, 'Chino service page');
    assert.equal(model.entries[0].publishedUrl, 'https://example.com/chino');
    assert.equal(model.entries[0].shippedOn, '2026-10-17');
    assert.equal(model.empty, null);
});

test('a task without a live URL leaves the results ledger unchanged', () => {
    assert.equal(taskToLedgerDeliverable({
        id: 'plain',
        title: 'Review robots.txt',
        status: 'done',
        category: 'technical',
        completedAt: NOW,
    }), null);
    assert.equal(completedAtForLiveUrl({
        status: 'done',
        completedAt: null,
        publishedUrl: null,
        now: NOW,
    }), undefined);
    assert.equal(completedAtForLiveUrl({
        status: 'todo',
        completedAt: null,
        publishedUrl: 'https://example.com/chino',
        now: NOW,
    }), undefined);

    const before = buildLedger(source([]), new Date('2026-10-17T18:00:00.000Z'));
    const after = buildLedger(source([]), new Date('2026-10-17T18:00:00.000Z'));
    assert.equal(after.empty, before.empty);
    assert.equal(after.entries.length, 0);
    assert.equal(after.latest, null);
    assert.equal(after.empty, 'No shipped work recorded yet. Work shows up here once it has a ship date and a page URL.');
});

test('completing work that already has a live URL keeps the first ship date', () => {
    assert.equal(completedAtForLiveUrl({
        status: 'done',
        completedAt: null,
        publishedUrl: 'https://example.com/chino',
        now: NOW,
    }), NOW);
    assert.equal(completedAtForLiveUrl({
        status: 'done',
        completedAt: '2026-10-02T20:00:00.000Z',
        publishedUrl: 'https://example.com/chino',
        now: NOW,
    }), undefined);
});

function source(deliverables: LedgerSource['deliverables']): LedgerSource {
    return {
        clientId: 'client',
        clientDomain: 'example.com',
        connected: false,
        property: null,
        lastSyncAt: null,
        lastSyncErrored: false,
        historyStart: null,
        earliestStoredDay: null,
        historyDays: 0,
        unsurfacedRows: 0,
        days: [],
        facts: [],
        deliverables,
    };
}
