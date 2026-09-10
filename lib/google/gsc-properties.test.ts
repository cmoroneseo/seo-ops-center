import test from 'node:test';
import assert from 'node:assert/strict';
import { describeProperty, filterProperties, readGscSites, selectGscProperty, reconnectCredentials } from './gsc-properties';
import { createGoogleOAuthState, verifyGoogleOAuthState } from '../security/oauth-state';

test('domain and URL prefix identities stay distinct including path and protocol', () => {
  assert.deepEqual(describeProperty('sc-domain:example.com'), { label: 'example.com', type: 'Domain property', scope: 'sc-domain:example.com' });
  assert.equal(describeProperty('https://www.example.com/blog/').scope, 'https://www.example.com/blog/');
  assert.equal(describeProperty('https://www.example.com/blog/').type, 'URL-prefix property');
});
const sites = [{ siteUrl: 'sc-domain:other.com', permissionLevel: 'siteOwner' }, { siteUrl: 'https://example.com/blog/', permissionLevel: 'siteFullUser' }, { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }];
test('search matches full scopes and client matches sort first without dropping variants', () => {
  assert.deepEqual(filterProperties(sites, 'blog', 'https://example.com').map(s => s.siteUrl), ['https://example.com/blog/']);
  assert.equal(filterProperties(sites, '', 'https://example.com')[2].siteUrl, 'sc-domain:other.com');
});
test('selection requires exact authorized catalog member and excludes unverified sites', () => {
  assert.equal(selectGscProperty(sites, 'https://example.com/'), null);
  assert.equal(selectGscProperty(sites, 'sc-domain:example.com')?.permissionLevel, 'siteOwner');
  assert.equal(selectGscProperty([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteUnverifiedUser' }], 'sc-domain:example.com'), null);
});
test('upstream API errors are not reported as empty catalogs', async () => {
  await assert.rejects(() => readGscSites('token', async () => new Response('{}', { status: 403 })), /permission/i);
  await assert.rejects(() => readGscSites('token', async () => new Response('{}', { status: 401 })), /reconnect/i);
  assert.deepEqual(await readGscSites('token', async () => Response.json({})), []);
});
test('reauthorization retains resource but never carries an old refresh token into a new grant', () => {
  const merged = reconnectCredentials({ site_url: 'sc-domain:example.com', access_token: 'old', refresh_token: 'old-secret', permission_level: 'siteOwner' }, { access_token: 'new', expiry_date: 42 });
  assert.equal(merged.site_url, 'sc-domain:example.com');
  assert.equal(merged.access_token, 'new');
  assert.equal(merged.refresh_token, undefined);
  assert.equal(merged.permission_level, undefined);
});
test('signed state accepts independent Google services and detects tampering', () => {
  process.env.GOOGLE_OAUTH_STATE_SECRET = 'test-gsc-state-secret';
  const state = createGoogleOAuthState({ clientId: 'client', orgId: 'org', group: 'gsc' });
  assert.equal(verifyGoogleOAuthState(state)?.group, 'gsc');
  assert.equal(verifyGoogleOAuthState(state + 'x'), null);
  assert.equal(verifyGoogleOAuthState(createGoogleOAuthState({ clientId: 'client', orgId: 'org', group: 'ga4' }))?.group, 'ga4');
});
