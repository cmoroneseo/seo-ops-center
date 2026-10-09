import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewHandlers, reviewContext, type PersistInput, type ReviewContext } from './review-route';
import type { ReportRow } from './reportStore';
import type { ReportVersionSnapshot } from './versions';

const org = '11111111-1111-4111-8111-111111111111';
const user = '33333333-3333-4333-8333-333333333333';
const owner = '22222222-2222-4222-8222-222222222222';
const client = '44444444-4444-4444-8444-444444444444';
const reportId = '66666666-6666-4666-8666-666666666666';

const report = {
    id: reportId,
    organization_id: org,
    client_id: client,
    report_month: '2026-09',
    title: 'September',
    executive_summary: 'Google showed the business 37,906 times.',
    recommendations: 'Keep the Eastvale page.',
    sections: { version: 2, blocks: [] },
    status: 'draft',
} as ReportRow;

function handlers(role: 'member' | 'owner' | 'viewer' = 'member', context: ReviewContext = reviewContext()) {
    const saved: PersistInput[] = [];
    const api = createReviewHandlers({
        access: async (_id, mode) => {
            if (role === 'viewer' && mode === 'write') return { ok: false, status: 403, error: 'Forbidden' };
            return {
                ok: true,
                report,
                auth: { userId: role === 'owner' ? owner : user, actorName: 'Ada', organizationId: org, role, isManager: role === 'owner' },
            };
        },
        loadContext: async () => ({ ok: true, context }),
        loadLedger: async () => [{
            id: 'ledger',
            title: 'Chino page',
            shippedOn: '2026-09-12',
            publishedUrl: 'https://example.com/chino',
            verdict: 'inconclusive',
            chip: 'Inconclusive',
            detail: 'Inconclusive.',
            footnote: null,
        }],
        loadPlan: async () => null,
        persist: async (input) => {
            saved.push(input);
            return { ok: true, versionId: input.plan.capture ? 'version-1' : input.plan.currentVersionId };
        },
        readSnapshot: async () => null,
        now: () => new Date('2026-10-01T15:00:00.000Z'),
    });
    return { api, saved };
}

const post = (body: unknown) => new Request('https://app.test/api/reports/x/approve', {
    method: 'POST',
    body: JSON.stringify(body),
});

test('approve ignores browser org and user ids and freezes a snapshot without emailing', async () => {
    const { api, saved } = handlers();
    const response = await api.post(reportId, post({
        action: 'approve',
        orgId: '99999999-9999-4999-8999-999999999999',
        clientId: '88888888-8888-4888-8888-888888888888',
        userId: '77777777-7777-4777-8777-777777777777',
        role: 'owner',
    }));
    assert.equal(response.status, 200);
    const write = saved[0];
    assert.equal(write.organizationId, org);
    assert.equal(write.clientId, client);
    assert.equal(write.actorId, user);
    assert.equal(write.plan.notifyClient, false);
    assert.equal(write.plan.toState, 'approved');
    assert.equal(write.plan.updatePortal, true);
    const snapshot = write.snapshot as ReportVersionSnapshot;
    assert.equal(snapshot.ledgerRows[0]?.title, 'Chino page');
    assert.equal(snapshot.metrics[0]?.data.organic_clicks, 65);
    assert.equal(write.contentHash?.length, 64);
});

test('a month with no work stays unapproved until there is a note, and a missing contact does not block', async () => {
    const quiet = reviewContext({ hours: 0, tasksCompleted: 0, shipped: 0 });
    const { api, saved } = handlers('member', quiet);
    const blocked = await api.post(reportId, post({ action: 'approve' }));
    assert.equal(blocked.status, 409);
    const body = await blocked.json();
    assert.equal(body.checks.some((check: { id: string }) => check.id === 'no_work'), true);
    assert.equal(saved.length, 0);

    const noted = await api.post(reportId, post({ action: 'approve', note: 'No pages shipped. The site stayed as it was.' }));
    assert.equal(noted.status, 200);
    assert.equal(saved[0]?.plan.notifyClient, false);
    assert.equal(saved[0]?.snapshot?.copy.whatWeDid, 'No pages shipped. The site stayed as it was.');
    assert.match(String(saved[0]?.snapshot?.portal.executiveSummary), /What we did/);
});

test('a new client needs a second approval from the owner on the same version', async () => {
    const fresh = reviewContext({ clientCreatedAt: '2026-09-01T00:00:00.000Z', reportCount: 1 });
    const first = handlers('member', fresh);
    const am = await first.api.post(reportId, post({ action: 'approve' }));
    assert.equal(am.status, 200);
    assert.equal(first.saved[0]?.plan.toState, 'ready_for_review');
    assert.equal(first.saved[0]?.plan.capture, true);
    assert.equal(first.saved[0]?.plan.updatePortal, false);

    const waiting = reviewContext({
        clientCreatedAt: '2026-09-01T00:00:00.000Z',
        reportCount: 1,
        review: {
            exists: true,
            state: 'ready_for_review',
            requiresOwnerApproval: true,
            amApprovedBy: user,
            ownerApprovedBy: null,
            currentVersionId: 'version-1',
            recipientContactId: null,
            scheduledFor: null,
            sentAt: null,
        },
    });
    const member = handlers('member', waiting);
    const memberView = await member.api.get(reportId, new Request('https://app.test/api/reports/x/versions'));
    assert.equal((await memberView.json()).canApprove, false);
    const denied = await member.api.post(reportId, post({ action: 'approve' }));
    assert.equal(denied.status, 403);
    assert.equal(member.saved.length, 0);

    const signer = handlers('owner', waiting);
    const ownerView = await signer.api.get(reportId, new Request('https://app.test/api/reports/x/versions'));
    assert.equal((await ownerView.json()).canApprove, true);
    const signed = await signer.api.post(reportId, post({ action: 'approve', userId: user }));
    assert.equal(signed.status, 200);
    assert.equal(signer.saved[0]?.plan.capture, false);
    assert.equal(signer.saved[0]?.plan.currentVersionId, 'version-1');
    assert.equal(signer.saved[0]?.actorId, owner);
    assert.equal(signer.saved[0]?.plan.updatePortal, true);
    assert.equal(signer.saved[0]?.snapshot, null);
});

test('a correction stores a new version and a visible note, and Ahrefs does not block', async () => {
    const approved = reviewContext({
        sources: [
            { source: 'gsc', connected: true, errored: false, lastSyncedAt: '2026-10-08T16:00:00.000Z' },
            { source: 'ahrefs', connected: true, errored: true, lastSyncedAt: '2026-09-01T00:00:00.000Z' },
        ],
        review: {
            exists: true,
            state: 'approved',
            requiresOwnerApproval: false,
            amApprovedBy: user,
            ownerApprovedBy: null,
            currentVersionId: 'version-1',
            recipientContactId: null,
            scheduledFor: null,
            sentAt: null,
        },
    });
    const { api, saved } = handlers('member', approved);
    const response = await api.post(reportId, post({ action: 'correct', note: 'The click total was 65, not 60.' }));
    assert.equal(response.status, 200);
    assert.equal(saved[0]?.plan.reason, 'correction');
    assert.equal(saved[0]?.plan.notifyClient, false);
    assert.equal(saved[0]?.snapshot?.correctionNote, 'The click total was 65, not 60.');
    const listed = await api.get(reportId, new Request('https://app.test/api/reports/x/versions'));
    const body = await listed.json();
    assert.equal(body.checks.some((check: { id: string; source?: string; severity: string }) => check.id === 'sync_error' && check.source === 'ahrefs' && check.severity === 'warn'), true);
    assert.equal(body.canApprove, false);
    assert.equal(body.banners[0].id, 'no_recipient');
    assert.equal(body.close.column, 'approved');
});

test('scheduling without a recipient is refused and a cross-org report is not found', async () => {
    const approved = reviewContext({
        review: {
            exists: true,
            state: 'approved',
            requiresOwnerApproval: false,
            amApprovedBy: user,
            ownerApprovedBy: null,
            currentVersionId: 'version-1',
            recipientContactId: null,
            scheduledFor: null,
            sentAt: null,
        },
    });
    const { api, saved } = handlers('member', approved);
    const response = await api.post(reportId, post({ action: 'schedule' }));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /recipient/);
    assert.equal(saved.length, 0);

    const hidden = createReviewHandlers({
        access: async () => ({ ok: false, status: 404, error: 'Not found' }),
        loadContext: async () => { throw new Error('loaded'); },
        loadLedger: async () => [],
        loadPlan: async () => null,
        persist: async () => { throw new Error('saved'); },
        readSnapshot: async () => null,
        now: () => new Date(),
    });
    assert.equal((await hidden.get(reportId, new Request('https://app.test/api/reports/x/versions'))).status, 404);
    assert.equal((await hidden.post(reportId, post({ action: 'approve' }))).status, 404);
});
