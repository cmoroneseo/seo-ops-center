import test from 'node:test';
import assert from 'node:assert/strict';
import { requireOrgAccess, requireReportAccess, type OrgMemberResult } from './access';
import type { ReportRow } from './reportStore';

const report = { id: '11111111-1111-4111-8111-111111111111', organization_id: 'org-a' } as ReportRow;
const member = (role: OrgMemberResult extends { ok: true } ? OrgMemberResult['role'] : never = 'member'): OrgMemberResult => ({
    ok: true, userId: 'user-a', actorName: 'Ada', organizationId: 'org-a', role, isManager: role === 'owner' || role === 'admin',
});

test('a bad report id is not found and is not looked up', async () => {
    const result = await requireReportAccess('not-a-uuid', 'read', {
        getReport: async () => { throw new Error('looked up'); },
        requireOrganizationMember: async () => { throw new Error('checked'); },
    });
    assert.deepEqual(result, { ok: false, status: 404, error: 'Not found' });
});

test('a missing report is not found', async () => {
    const result = await requireReportAccess(report.id, 'read', {
        getReport: async () => null,
        requireOrganizationMember: async () => { throw new Error('checked'); },
    });
    assert.deepEqual(result, { ok: false, status: 404, error: 'Not found' });
});

test('a member of another organization cannot tell that the report exists', async () => {
    const result = await requireReportAccess(report.id, 'read', {
        getReport: async () => report,
        requireOrganizationMember: async () => ({ ok: false, status: 403, error: 'Forbidden' }),
    });
    assert.deepEqual(result, { ok: false, status: 404, error: 'Not found' });
});

test('an unsigned request stays 401', async () => {
    const result = await requireReportAccess(report.id, 'read', {
        getReport: async () => report,
        requireOrganizationMember: async () => ({ ok: false, status: 401, error: 'Unauthorized' }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
});

test('a viewer can read a report and cannot write it', async () => {
    const deps = { getReport: async () => report, requireOrganizationMember: async () => member('viewer') };
    assert.equal((await requireReportAccess(report.id, 'read', deps)).ok, true);
    const write = await requireReportAccess(report.id, 'write', deps);
    assert.deepEqual(write, { ok: false, status: 403, error: 'Forbidden' });
});

test('a member can read', async () => {
    const result = await requireReportAccess(report.id, 'read', {
        getReport: async () => report,
        requireOrganizationMember: async () => member('member'),
    });
    assert.equal(result.ok, true);
});

test('org access rejects a missing id, a non-member, and a viewer write', async () => {
    const deps = {
        requireOrganizationMember: async (orgId: unknown) => {
            if (typeof orgId !== 'string' || orgId.length === 0) return { ok: false as const, status: 400 as const, error: 'Missing organization' };
            return orgId === 'org-a' ? member('viewer') : { ok: false as const, status: 403 as const, error: 'Forbidden' };
        },
    };
    assert.equal((await requireOrgAccess('', 'read', deps)).status, 400);
    assert.equal((await requireOrgAccess('org-b', 'read', deps)).status, 403);
    assert.equal((await requireOrgAccess('org-a', 'write', deps)).status, 403);
    assert.equal((await requireOrgAccess('org-a', 'read', deps)).ok, true);
});
