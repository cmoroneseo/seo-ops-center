import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    GTM_READONLY_SCOPE,
    filterGtmContainers,
    gtmEventTagsFromVersion,
    readGtmContainers,
    readLiveGtmEventTags,
    selectGtmContainer,
    type GtmContainerChoice,
} from './gtm-containers.ts';
import { GTM_READONLY_SCOPE as SCOPE_FROM_ACCOUNT, googleOAuthScopes, isGoogleOAuthGroup, syncStatusAfterGoogleReconnect } from './account.ts';
import { reconnectCredentials } from './gsc-properties.ts';
import { createGoogleOAuthState, verifyGoogleOAuthState } from '../security/oauth-state.ts';

const containers: GtmContainerChoice[] = [
    {
        accountId: '6361320998',
        accountName: 'Kentina Hospitality',
        containerId: '255732081',
        name: 'Kentina web',
        publicId: 'GTM-W8Q8SC6V',
    },
    {
        accountId: '1111222233',
        accountName: 'Other',
        containerId: '999',
        name: 'Other site',
        publicId: 'GTM-OTHER',
    },
];

function page(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('Tag Manager OAuth is read-only and is its own connect group', () => {
    assert.equal(GTM_READONLY_SCOPE, 'https://www.googleapis.com/auth/tagmanager.readonly');
    assert.equal(SCOPE_FROM_ACCOUNT, GTM_READONLY_SCOPE);
    const scopes = googleOAuthScopes('gtm');
    assert.deepEqual(scopes, [
        'https://www.googleapis.com/auth/tagmanager.readonly',
        'openid',
        'email',
    ]);
    assert.equal(scopes.some(scope => scope.endsWith('.edit') || scope.includes('publish') || scope.endsWith('.manage')), false);
    assert.equal(isGoogleOAuthGroup('gtm'), true);
    assert.equal(googleOAuthScopes('ga4').includes(GTM_READONLY_SCOPE), false);
});

test('container search matches the public id, account, and name', () => {
    assert.deepEqual(filterGtmContainers(containers, 'GTM-W8Q8SC6V').map(container => container.containerId), ['255732081']);
    assert.deepEqual(filterGtmContainers(containers, 'kentina').map(container => container.publicId), ['GTM-W8Q8SC6V']);
    assert.equal(filterGtmContainers(containers, 'missing').length, 0);
});

test('selection accepts only a container that was listed', () => {
    assert.equal(selectGtmContainer(containers, '6361320998', '255732081')?.publicId, 'GTM-W8Q8SC6V');
    assert.equal(selectGtmContainer(containers, '6361320998', '1'), null);
    assert.equal(selectGtmContainer(containers, 'not-an-id', '255732081'), null);
    assert.equal(selectGtmContainer(containers, '1111222233', '255732081'), null);
});

test('account and container pages are followed and a bad response does not leak the token', async () => {
    const urls: string[] = [];
    const request: typeof fetch = async (input, init) => {
        const url = String(input);
        urls.push(url);
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer token-secret');
        if (url.endsWith('/accounts')) {
            return page({
                account: [{ accountId: '6361320998', name: 'Kentina Hospitality' }],
                nextPageToken: 'accounts-2',
            });
        }
        if (url.includes('pageToken=accounts-2')) {
            return page({ account: [{ accountId: '42', name: 'Small' }] });
        }
        if (url.includes('/accounts/6361320998/containers') && !url.includes('pageToken')) {
            return page({
                container: [{
                    accountId: '6361320998',
                    containerId: '255732081',
                    publicId: 'GTM-W8Q8SC6V',
                    name: 'Kentina web',
                }],
            });
        }
        if (url.includes('/accounts/42/containers')) return page({ container: [] });
        return page({}, 404);
    };
    const listed = await readGtmContainers('token-secret', request, () => { throw new Error('must not log success'); });
    assert.deepEqual(listed.map(container => container.publicId), ['GTM-W8Q8SC6V']);
    assert.equal(urls.join('\n').includes('token-secret'), false);

    const logs: number[] = [];
    await assert.rejects(
        () => readGtmContainers('token-secret', async () => page({ error: 'token-secret leaked' }, 403), status => logs.push(status)),
        (error: Error) => {
            assert.equal(error.message.includes('token-secret'), false);
            assert.equal(error.message.includes('leaked'), false);
            return true;
        },
    );
    assert.deepEqual(logs, [403]);
});

test('live version keeps GA4 event tags and skips paused and non-event tags', async () => {
    const tags = gtmEventTagsFromVersion({
        tag: [
            {
                name: 'Booking',
                type: 'gaawe',
                parameter: [{ key: 'eventName', value: 'booking_click' }],
            },
            {
                name: 'Paused outbound',
                type: 'gaawe',
                paused: true,
                parameter: [{ key: 'eventName', value: 'property_outbound_click' }],
            },
            { name: 'HTML', type: 'html', parameter: [{ key: 'eventName', value: 'ignored' }] },
            { name: 'No name', type: 'gaawe', parameter: [] },
        ],
    });
    assert.deepEqual(tags, [
        { name: 'Booking', eventName: 'booking_click', paused: false },
        { name: 'Paused outbound', eventName: 'property_outbound_click', paused: true },
    ]);

    const urls: string[] = [];
    const live = await readLiveGtmEventTags('token-secret', '6361320998', '255732081', async (input, init) => {
        urls.push(String(input));
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer token-secret');
        return page({ containerVersion: { tag: [{ name: 'Tickets', type: 'gaawe', parameter: [{ key: 'eventName', value: 'buy_tickets_click' }] }] } });
    });
    assert.equal(live[0]?.eventName, 'buy_tickets_click');
    assert.match(urls[0], /accounts\/6361320998\/containers\/255732081\/versions:live$/);
    assert.equal(urls[0].includes('token-secret'), false);
});

test('reconnect keeps the chosen container and the signed state accepts the gtm group', () => {
    const merged = reconnectCredentials({
        container_id: '255732081',
        account_id: '6361320998',
        public_id: 'GTM-W8Q8SC6V',
        display_name: 'Kentina web',
        refresh_token: 'old-secret',
    }, { access_token: 'new', google_email: 'ada@agency.test' });
    assert.equal(merged.container_id, '255732081');
    assert.equal(merged.account_id, '6361320998');
    assert.equal(merged.public_id, 'GTM-W8Q8SC6V');
    assert.equal(merged.display_name, 'Kentina web');
    assert.equal(merged.refresh_token, undefined);
    assert.equal(syncStatusAfterGoogleReconnect({
        service: 'gtm',
        previousStatus: 'active',
        credentials: { container_id: '255732081' },
    }), 'active');
    assert.equal(syncStatusAfterGoogleReconnect({
        service: 'gtm',
        previousStatus: 'pending_setup',
        credentials: {},
    }), 'pending_setup');

    process.env.GOOGLE_OAUTH_STATE_SECRET = 'test-gtm-state-secret';
    const state = createGoogleOAuthState({ clientId: 'client', orgId: 'org', group: 'gtm' });
    assert.equal(verifyGoogleOAuthState(state)?.group, 'gtm');
});

test('migration 120 allows gtm without dropping bing, and does not seed a client', () => {
    const sql = readFileSync(new URL('../../migrations/120_gtm_integration.sql', import.meta.url), 'utf8');
    assert.match(sql, /service in \('ga4', 'gsc', 'gbp', 'ahrefs', 'bing', 'gtm'\)/);
    assert.equal(sql.toLowerCase().includes('insert into'), false);
    assert.match(sql, /NOT APPLIED/);
});
