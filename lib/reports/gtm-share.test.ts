import test from 'node:test';
import assert from 'node:assert/strict';
import { hashToken } from '../approvals/token.ts';
import { buildGtmEventsReport, type BuildGtmEventsInput } from './gtm-events.ts';
import { decidePublicShare, newPublicToken, resolvePublicShare, snapshotFromFrozenVersion } from './gtm-share.ts';

function report() {
    const input: BuildGtmEventsInput = {
        clientName: 'Kentina Hospitality',
        reportMonth: '2026-10',
        capturedAt: '2026-11-09T18:00:00.000Z',
        sessions: { current: 4, prior: 2 },
        events: { current: [{ eventName: 'page_view', count: 4 }], prior: [{ eventName: 'page_view', count: 1 }] },
        links: { current: [], prior: [] },
        daily: [],
        excludedLinkTexts: [],
        tagSource: 'unavailable',
        tags: [],
        fallbackEventNames: [],
        outboundEventName: 'property_outbound_click',
        bookingEventName: 'booking_click',
        ticketEventName: 'buy_tickets_click',
    };
    return buildGtmEventsReport(input);
}

test('a public link is refused when it is missing, revoked, or expired, and revocation wins', () => {
    const { token, tokenHash } = newPublicToken();
    const snapshot = report();
    const now = new Date('2026-11-10T00:00:00.000Z');
    assert.equal(decidePublicShare(null, token, now).ok, false);
    assert.equal(decidePublicShare({ tokenHash: hashToken('other-token-value-with-enough-length'), revokedAt: null, expiresAt: null, snapshot }, token, now).ok, false);
    const revoked = decidePublicShare({
        tokenHash,
        revokedAt: '2026-11-01T00:00:00.000Z',
        expiresAt: '2026-11-02T00:00:00.000Z',
        snapshot,
    }, token, now);
    assert.deepEqual(revoked, { ok: false, denial: 'revoked' });
    const expired = decidePublicShare({
        tokenHash,
        revokedAt: null,
        expiresAt: '2026-11-09T00:00:00.000Z',
        snapshot,
    }, token, now);
    assert.deepEqual(expired, { ok: false, denial: 'expired' });
    const open = decidePublicShare({ tokenHash, revokedAt: null, expiresAt: null, snapshot: { ...snapshot, refresh_token: 'secret', staffNote: 'internal' } }, token, now);
    assert.equal(open.ok, true);
    if (!open.ok) return;
    const serialized = JSON.stringify(open.snapshot);
    assert.equal(serialized.includes('secret'), false);
    assert.equal(serialized.includes('staffNote'), false);
    assert.equal(serialized.includes('refresh_token'), false);
    assert.equal(open.snapshot.clientName, 'Kentina Hospitality');
});

test('lookup uses the token hash and a frozen version ignores staff notes', async () => {
    const { token, tokenHash } = newPublicToken();
    const snapshot = report();
    const hashes: string[] = [];
    const result = await resolvePublicShare(token, {
        now: () => new Date('2026-11-10T00:00:00.000Z'),
        findByHash: async hash => {
            hashes.push(hash);
            assert.equal(hash, tokenHash);
            assert.notEqual(hash, token);
            return { tokenHash, revokedAt: null, expiresAt: null, snapshot };
        },
    });
    assert.equal(hashes[0], tokenHash);
    assert.equal(result.ok, true);

    const frozen = snapshotFromFrozenVersion({
        portal: {
            sections: {
                blocks: [{
                    type: 'gtm_events',
                    props: { snapshot, staffNote: 'https://www.googleapis.com/auth/tagmanager.readonly', refresh_token: 'secret' },
                }],
            },
        },
    });
    assert.equal(JSON.stringify(frozen).includes('tagmanager.readonly'), false);
    assert.equal(JSON.stringify(frozen).includes('secret'), false);
    assert.equal(snapshotFromFrozenVersion({ portal: { sections: { blocks: [] } } }), null);
});
