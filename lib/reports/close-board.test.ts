import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloseBoard, closeTitle, filterCloseBoard, moveSelection, type CloseRaw } from './close-board';
import { reportsNavHref } from './close-nav';

const NOW = new Date('2026-10-09T18:00:00.000Z');
const PROPERTY = 'sc-domain:secret.example';

function id(prefix: string, index: number): string {
    return `${prefix}-${String(index).padStart(4, '0')}`;
}

function septemberDays(clientId: string, count: number, incomplete = false) {
    const days = [];
    const facts = [];
    for (let day = 1; day <= count; day += 1) {
        const dayId = `${clientId}-d${day}`;
        days.push({
            id: dayId,
            clientId,
            property: PROPERTY,
            date: `2026-09-${String(day).padStart(2, '0')}`,
            isIncomplete: incomplete,
        });
        facts.push({ dayId, clicks: 1, impressions: 3 });
    }
    return { days, facts };
}

function sixtyClients(): CloseRaw {
    const raw: CloseRaw = {
        month: '2026-09',
        now: NOW,
        role: 'member',
        clients: [],
        reports: [],
        reviews: [],
        integrations: [],
        hours: [],
        completedTaskClientIds: [],
        deliverables: [],
        metrics: [],
        gscDays: [],
        gscFacts: [],
        recipientClientIds: [],
    };
    for (let index = 0; index < 60; index += 1) {
        const clientId = id('client', index);
        raw.clients.push({
            id: clientId,
            name: `Client ${String(index).padStart(2, '0')}`,
            domain: `c${index}.example`,
            accountManagerId: index % 2 === 0 ? 'mgr-a' : 'mgr-b',
            accountManagerName: index % 2 === 0 ? 'Carlos' : 'Abel Miranda',
            seoHours: 10,
        });
        if (index < 27) {
            if (index < 6) raw.hours.push({ clientId, hours: 4 });
            if (index === 0) {
                raw.integrations.push({ clientId, service: 'ahrefs', syncStatus: 'error', lastSyncedAt: null, siteUrl: null });
            }
            continue;
        }
        const withReport = index <= 36;
        const connected = index !== 34;
        if (connected) {
            raw.integrations.push({
                clientId,
                service: 'gsc',
                syncStatus: 'active',
                lastSyncedAt: '2026-10-08T16:00:00.000Z',
                siteUrl: PROPERTY,
            });
            const span = withReport ? septemberDays(clientId, 30) : septemberDays(clientId, 10);
            raw.gscDays.push(...span.days);
            raw.gscFacts.push(...span.facts);
        }
        if (!withReport) continue;
        const reportId = id('report', index);
        raw.reports.push({
            id: reportId,
            clientId,
            kind: 'monthly',
            title: 'September',
            status: 'draft',
            executiveSummary: '',
            recommendations: '',
            sections: null,
            updatedAt: '2026-10-01T00:00:00.000Z',
        });
        let state = 'draft';
        if (index === 34) state = 'approved';
        if (index === 35) state = 'scheduled';
        if (index === 36) state = 'sent';
        if (index >= 31 && index <= 33) {
            raw.hours.push({ clientId, hours: 8 });
            raw.completedTaskClientIds.push(clientId);
        }
        if (index >= 27 && index <= 30) {
            raw.deliverables.push({ clientId, publishedUrl: null, deliveredOn: null });
        }
        if (index === 31 || index === 32) {
            raw.integrations.push({ clientId, service: 'ahrefs', syncStatus: 'error', lastSyncedAt: null, siteUrl: null });
        }
        const frozen = state === 'approved' || state === 'scheduled' || state === 'sent';
        raw.reviews.push({
            reportId,
            state,
            requiresOwnerApproval: index === 33,
            amApprovedBy: index === 33 || frozen ? 'am' : null,
            ownerApprovedBy: frozen ? 'owner' : null,
            currentVersionId: index === 33 || frozen ? 'version' : null,
            amNote: null,
            scheduledFor: state === 'scheduled' ? '2026-10-07T16:00:00.000Z' : null,
            sentAt: state === 'sent' ? '2026-10-08T16:00:00.000Z' : null,
        });
    }
    return raw;
}

test('sixty clients land in the close columns without a second query shape', () => {
    const started = Date.now();
    const board = buildCloseBoard(sixtyClients());
    assert.ok(Date.now() - started < 1500);
    assert.equal(board.title, 'Reports · September close');
    assert.equal(closeTitle('2026-09'), board.title);
    assert.equal(board.activeClients, 60);
    assert.equal(board.drafts, 7);
    assert.equal(board.noSearchConsole.length, 27);
    assert.equal(board.pendingDrafts.length, 23);
    assert.equal(board.waitingOnData, 50);
    assert.equal(board.meta, '60 active clients · 7 drafts · 50 waiting on data');
    assert.equal(board.hoursLoggedWithoutConsole, 6);
    assert.equal(board.columns.blocked.length, 4);
    assert.equal(board.columns.ready.length, 3);
    assert.equal(board.columns.approved.length, 2);
    assert.equal(board.columns.sent.length, 1);
    assert.equal(board.columns.approved.some(card => card.clientName === 'Client 34'), true);
    assert.equal(board.noSearchConsole.some(row => row.clientName === 'Client 34'), false);
    assert.deepEqual(board.trackerErrors.map(row => row.clientName), ['Client 31', 'Client 32']);
    assert.equal(board.banner?.message, 'No client has a portal contact on file. You can approve; scheduling waits for a recipient.');
    assert.match(board.columns.blocked[0].previewHref, /\?range=2026-09$/);
    assert.equal(JSON.stringify(board).includes(PROPERTY), false);
    assert.equal(JSON.stringify(board).includes('Needs attention'), false);
    assert.equal(board.columns.blocked[0].blockingCount > 0, true);
    assert.equal(board.nextInProgress, true);
    assert.equal(board.inProgress, false);
});

test('filters narrow the columns and the recipient banner stays one line', () => {
    const board = buildCloseBoard(sixtyClients());
    const managed = filterCloseBoard(board, { query: '', managerId: 'mgr-a', status: 'all' });
    assert.equal(managed.columns.blocked.length, 2);
    assert.equal(managed.columns.ready.length, 1);
    assert.equal(managed.banner?.message, board.banner?.message);
    const blocked = filterCloseBoard(board, { query: 'client 28', managerId: 'all', status: 'blocked' });
    assert.equal(blocked.columns.blocked.length, 1);
    assert.equal(blocked.columns.ready.length, 0);
    assert.equal(blocked.noSearchConsole.length, 0);
    const partial = buildCloseBoard({
        ...sixtyClients(),
        recipientClientIds: [sixtyClients().clients[0].id],
    });
    assert.match(partial.banner?.message ?? '', /^59 clients have no portal contact/);
    const covered = buildCloseBoard({
        ...sixtyClients(),
        recipientClientIds: sixtyClients().clients.map(client => client.id),
    });
    assert.equal(covered.banner, null);
});

test('arrow keys move between cards and skip an empty column', () => {
    const cards = [
        { id: 'b1', column: 'blocked' as const },
        { id: 'b2', column: 'blocked' as const },
        { id: 'r1', column: 'ready' as const },
        { id: 's1', column: 'sent' as const },
    ];
    assert.equal(moveSelection(cards, null, 'ArrowDown'), 'b1');
    assert.equal(moveSelection(cards, 'b1', 'ArrowDown'), 'b2');
    assert.equal(moveSelection(cards, 'b2', 'ArrowDown'), 'b2');
    assert.equal(moveSelection(cards, 'b1', 'ArrowRight'), 'r1');
    assert.equal(moveSelection(cards, 'r1', 'ArrowRight'), 's1');
    assert.equal(moveSelection(cards, 's1', 'ArrowLeft'), 'r1');
    assert.equal(moveSelection(cards, 'b2', 'Home'), 'b1');
    assert.equal(moveSelection(cards, 'b1', 'End'), 's1');
});

test('the reports nav opens the close board only when reporting is on', () => {
    const previous = process.env.NEXT_PUBLIC_SEARCH_REPORTING;
    try {
        delete process.env.NEXT_PUBLIC_SEARCH_REPORTING;
        assert.equal(reportsNavHref(), '/reports');
        process.env.NEXT_PUBLIC_SEARCH_REPORTING = 'true';
        assert.equal(reportsNavHref(), '/reports/close');
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_SEARCH_REPORTING;
        else process.env.NEXT_PUBLIC_SEARCH_REPORTING = previous;
    }
});
