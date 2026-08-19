import { authorizedProjectId, type SelectableBasecampProject } from './project-selection.ts';

export interface BasecampImportScope<TProject = never, TListState = never> {
    step: 'project';
    projects: TProject[];
    projectsLoading: false;
    selectedProjectId: '';
    listsLoading: false;
    listStates: TListState[];
    alreadyImportedIds: number[];
    priority: 'medium';
    importing: false;
    importedCount: 0;
    importError: '';
}

export function emptyBasecampImportScope<TProject = never, TListState = never>(): BasecampImportScope<TProject, TListState> {
    return {
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
    };
}

interface StoredBasecampConfig {
    basecamp_project_id?: string | number;
    basecamp_todolist_id?: string | number;
    basecamp_sync_enabled?: boolean;
    basecamp_timesheet_enabled?: boolean;
}

export interface BasecampIntegrationScope {
    projectId: string;
    todolistId: string;
    syncEnabled: boolean;
    timesheetEnabled: boolean;
    importOpen: false;
}

export function emptyBasecampIntegrationScope(): BasecampIntegrationScope {
    return {
        projectId: '',
        todolistId: '',
        syncEnabled: false,
        timesheetEnabled: false,
        importOpen: false,
    };
}

export function integrationScopeFromCatalog(
    catalog: SelectableBasecampProject[],
    config: StoredBasecampConfig,
): BasecampIntegrationScope {
    const projectId = authorizedProjectId(catalog, config.basecamp_project_id);
    if (!projectId) return emptyBasecampIntegrationScope();

    return {
        projectId,
        todolistId: config.basecamp_todolist_id ? String(config.basecamp_todolist_id) : '',
        syncEnabled: config.basecamp_sync_enabled === true,
        timesheetEnabled: config.basecamp_timesheet_enabled === true,
        importOpen: false,
    };
}
