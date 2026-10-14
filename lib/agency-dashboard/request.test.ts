import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPortfolioPath, dashboardQueriesPath, teamMatchesSession } from './request.ts';

test('dashboard URLs carry the organization so a team switch cannot reuse the previous response', () => {
    assert.equal(dashboardPortfolioPath('12m', 'org-a'), '/api/agency-dashboard?range=12m&team=org-a');
    assert.equal(
        dashboardQueriesPath('28d', 'org-a', 'client-1'),
        '/api/agency-dashboard/queries?range=28d&team=org-a&clientId=client-1',
    );
    assert.equal(teamMatchesSession(null, 'org-a'), true);
    assert.equal(teamMatchesSession('', 'org-a'), true);
    assert.equal(teamMatchesSession('org-a', 'org-a'), true);
    assert.equal(teamMatchesSession('org-b', 'org-a'), false);
});
