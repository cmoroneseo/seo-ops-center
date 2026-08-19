import { test } from 'node:test';
import assert from 'node:assert/strict';

type ScopeModule = typeof import('./scope-state.ts');

async function loadScopeModule(): Promise<ScopeModule> {
    try {
        return await import('./scope-state.ts');
    } catch (error) {
        assert.fail(`Basecamp organization scope reset state must be implemented: ${String(error)}`);
    }
}

test('a new import organization scope clears every project and list workflow field', async () => {
    const { emptyBasecampImportScope } = await loadScopeModule();
    assert.deepEqual(emptyBasecampImportScope(), {
        step: 'project',
        projects: [],
        projectsLoading: false,
        selectedProjectId: '',
        listsLoading: false,
        listStates: [],
        alreadyImportedIds: [],
        priority: 'medium',
        importing: false,
        importedCount: 0,
        importError: '',
    });
});

test('an integration scope rejects config whose project is absent from the authorized catalog', async () => {
    const { integrationScopeFromCatalog } = await loadScopeModule();
    assert.deepEqual(integrationScopeFromCatalog(
        [{ id: 202, name: 'Allowed' }],
        {
            basecamp_project_id: 999,
            basecamp_todolist_id: 55,
            basecamp_sync_enabled: true,
            basecamp_timesheet_enabled: true,
        },
    ), {
        projectId: '',
        todolistId: '',
        syncEnabled: false,
        timesheetEnabled: false,
        importOpen: false,
    });
});

test('an integration scope restores config only after the catalog authorizes its project', async () => {
    const { integrationScopeFromCatalog } = await loadScopeModule();
    assert.deepEqual(integrationScopeFromCatalog(
        [{ id: 202, name: 'Allowed' }],
        {
            basecamp_project_id: 202,
            basecamp_todolist_id: 55,
            basecamp_sync_enabled: true,
            basecamp_timesheet_enabled: true,
        },
    ), {
        projectId: '202',
        todolistId: '55',
        syncEnabled: true,
        timesheetEnabled: true,
        importOpen: false,
    });
});
