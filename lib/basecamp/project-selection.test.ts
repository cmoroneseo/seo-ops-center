import { test } from 'node:test';
import assert from 'node:assert/strict';

type SelectionModule = typeof import('./project-selection.ts');

async function loadSelectionModule(): Promise<SelectionModule> {
    try {
        return await import('./project-selection.ts');
    } catch (error) {
        assert.fail(`Catalog-gated Basecamp project selection must be implemented: ${String(error)}`);
    }
}

const catalog = [
    { id: '101', name: 'Authorized A' },
    { id: '202', name: 'Authorized B' },
];

test('recent projects fail closed until an authorized catalog has loaded', async () => {
    const { authorizedRecentProjects } = await loadSelectionModule();
    assert.deepEqual(authorizedRecentProjects(null, [catalog[0]]), []);
});

test('recent projects are intersected with the authorized catalog and use its current project data', async () => {
    const { authorizedRecentProjects } = await loadSelectionModule();
    assert.deepEqual(authorizedRecentProjects(catalog, [
        { id: '999', name: 'Leaked project' },
        { id: '202', name: 'Stale name' },
    ]), [catalog[1]]);
});

test('preselection and drill-down reject a project absent from the authorized catalog', async () => {
    const { authorizedProjectId } = await loadSelectionModule();
    assert.equal(authorizedProjectId(catalog, '202'), '202');
    assert.equal(authorizedProjectId(catalog, '999'), null);
    assert.equal(authorizedProjectId(null, '202'), null);
});
