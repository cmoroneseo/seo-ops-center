import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateHandlers } from './template-routes';

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const templateId = '66666666-6666-4666-8666-666666666666';

test('listing another organization is forbidden', async () => {
    const handlers = createTemplateHandlers({
        requireOrganizationMember: async () => ({ ok: false, status: 403, error: 'Forbidden' }),
        listTemplates: async () => { throw new Error('listed'); },
        getTemplate: async () => null,
        createTemplate: async () => ({}),
        deleteTemplate: async () => { throw new Error('deleted'); },
    });
    assert.equal((await handlers.list(new Request(`https://app.test/api/report-templates?orgId=${other}`))).status, 403);
});

test('deleting a template in another organization is not found and deletes nothing', async () => {
    let deleted = 0;
    const handlers = createTemplateHandlers({
        requireOrganizationMember: async (orgId) => orgId === org
            ? { ok: true, userId: 'user', actorName: 'Ada', organizationId: org, role: 'member', isManager: false }
            : { ok: false, status: 403, error: 'Forbidden' },
        listTemplates: async () => [],
        getTemplate: async () => ({ id: templateId, organization_id: other, name: 'Theirs', blocks: [], created_by: null, created_at: '' }),
        createTemplate: async () => ({}),
        deleteTemplate: async () => { deleted += 1; return {}; },
    });
    const response = await handlers.remove(new Request(`https://app.test/api/report-templates?id=${templateId}`));
    assert.equal(response.status, 404);
    assert.equal(deleted, 0);
});
