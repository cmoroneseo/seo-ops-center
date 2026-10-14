import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENCY_DASHBOARD_HREF, AGENCY_DASHBOARD_SANDBOX_ORG_ID, agencyDashboardEnabled, agencyDashboardNav } from './flags.ts';

const OTHER = '11111111-1111-4111-8111-111111111111';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
}

test('the agency dashboard stays off unless the flag is exactly true and the org is allowlisted', () => {
    assert.equal(agencyDashboardEnabled(env({}), AGENCY_DASHBOARD_SANDBOX_ORG_ID), false);
    assert.equal(agencyDashboardEnabled(env({ AGENCY_DASHBOARD: '1' }), AGENCY_DASHBOARD_SANDBOX_ORG_ID), false);
    assert.equal(agencyDashboardEnabled(env({ AGENCY_DASHBOARD: 'TRUE', AGENCY_DASHBOARD_ORG_IDS: AGENCY_DASHBOARD_SANDBOX_ORG_ID }), AGENCY_DASHBOARD_SANDBOX_ORG_ID), false);
    assert.equal(agencyDashboardEnabled(env({ AGENCY_DASHBOARD: 'true' }), AGENCY_DASHBOARD_SANDBOX_ORG_ID), false);
    assert.equal(agencyDashboardEnabled(env({ AGENCY_DASHBOARD: 'true', AGENCY_DASHBOARD_ORG_IDS: '' }), AGENCY_DASHBOARD_SANDBOX_ORG_ID), false);
    assert.equal(agencyDashboardEnabled(env({ AGENCY_DASHBOARD: 'true', AGENCY_DASHBOARD_ORG_IDS: 'nope' }), AGENCY_DASHBOARD_SANDBOX_ORG_ID), false);
    assert.equal(agencyDashboardEnabled(env({
        AGENCY_DASHBOARD: 'true',
        AGENCY_DASHBOARD_ORG_IDS: ` ${AGENCY_DASHBOARD_SANDBOX_ORG_ID.toUpperCase()} , not-a-uuid `,
    }), AGENCY_DASHBOARD_SANDBOX_ORG_ID), true);
    assert.equal(agencyDashboardEnabled(env({
        AGENCY_DASHBOARD: 'true',
        AGENCY_DASHBOARD_ORG_IDS: AGENCY_DASHBOARD_SANDBOX_ORG_ID,
    }), OTHER), false);
    assert.equal(agencyDashboardEnabled(env({
        AGENCY_DASHBOARD: 'true',
        AGENCY_DASHBOARD_ORG_IDS: AGENCY_DASHBOARD_SANDBOX_ORG_ID,
    })), false);
});

test('the Dashboard nav item is separate from Home and hidden while the flag is off', () => {
    const items = [
        { name: 'Home', href: '/dashboard' },
        { name: 'Dashboard', href: AGENCY_DASHBOARD_HREF },
        { name: 'Workspace', href: '/workspace' },
    ];
    assert.deepEqual(agencyDashboardNav(items, false).map(item => item.name), ['Home', 'Workspace']);
    assert.deepEqual(agencyDashboardNav(items, true).map(item => item.href), ['/dashboard', '/agency', '/workspace']);
});
