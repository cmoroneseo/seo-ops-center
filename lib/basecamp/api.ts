/**
 * Basecamp 3 API client.
 *
 * Authentication: OAuth 2.0 Access Token
 * Requires environment variables:
 *   BASECAMP_ACCESS_TOKEN  — provisioned through the controlled operator secret path
 *   BASECAMP_ACCOUNT_ID    — e.g. 5338018 (from https://3.basecampapi.com/5338018)
 *
 * All calls are server-side only (API routes / Server Actions).
 * Never import this file in client components.
 *
 * Basecamp 3 URL patterns:
 *   - Projects:   /projects.json
 *   - Todolists:  /buckets/{projectId}/todosets/{todosetId}/todolists.json
 *   - Todos:      /buckets/{projectId}/todolists/{todolistId}/todos.json
 *   - Complete:   /buckets/{projectId}/todos/{todoId}/completion.json
 *   - Comments:   /buckets/{projectId}/recordings/{recordingId}/comments.json
 */

import type { ProviderTimesheetEntry } from './timesheet-webhook-route';
import { nextPageUrl } from './pagination';

const BASE_URL = () => {
    const accountId = process.env.BASECAMP_ACCOUNT_ID;
    if (!accountId) throw new Error('BASECAMP_ACCOUNT_ID env var not set');
    return `https://3.basecampapi.com/${accountId}`;
};

/**
 * Basecamp record IDs are always positive integers. Interpolating an
 * unvalidated caller-supplied value into a request path is a request-forgery
 * risk, so coerce every ID through this guard before it reaches a URL — it
 * returns the canonical digit string or throws (callers already try/catch and
 * degrade to a null/false result).
 */
function safeId(value: number | string, label = 'id'): string {
    const s = String(value).trim();
    if (!/^\d+$/.test(s)) throw new Error(`Invalid Basecamp ${label}: ${s}`);
    return s;
}

let cachedAccessToken: string | null = null;

async function getAccessToken(): Promise<string> {
    if (cachedAccessToken) return cachedAccessToken;
    const token = process.env.BASECAMP_ACCESS_TOKEN;
    if (!token) throw new Error('BASECAMP_ACCESS_TOKEN env var not set');
    return token;
}

async function refreshAccessToken(): Promise<string> {
    const refreshToken = process.env.BASECAMP_REFRESH_TOKEN;
    const clientId = process.env.BASECAMP_CLIENT_ID;
    const clientSecret = process.env.BASECAMP_CLIENT_SECRET;
    if (!refreshToken || !clientId || !clientSecret) {
        throw new Error('Cannot refresh Basecamp token — BASECAMP_REFRESH_TOKEN, BASECAMP_CLIENT_ID, and BASECAMP_CLIENT_SECRET are all required');
    }
    const res = await fetch('https://launchpad.37signals.com/authorization/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            type: 'refresh',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Basecamp token refresh failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    cachedAccessToken = data.access_token;
    console.log('[Basecamp] Access token refreshed successfully');
    return data.access_token;
}

function buildHeaders(token: string): Record<string, string> {
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SEO Ops Center (seo@marketingempiregroup.com)',
    };
}

async function basecampFetch(url: string, init?: RequestInit): Promise<Response> {
    const token = await getAccessToken();
    const res = await fetch(url, { ...init, headers: { ...buildHeaders(token), ...init?.headers } });
    if (res.status === 401) {
        const freshToken = await refreshAccessToken();
        return fetch(url, { ...init, headers: { ...buildHeaders(freshToken), ...init?.headers } });
    }
    return res;
}


export interface BasecampProject {
    id: number;
    name: string;
    description: string;
    status: string;
}

export interface BasecampTodolist {
    id: number;
    title: string;
    name: string;
    todos_count: number;
}

export interface BasecampTodo {
    id: number;
    title: string;
    due_on: string | null;
    completed: boolean;
    url: string;
    app_url: string;
}

export interface BasecampTodoFull {
    id: number;
    title: string;
    due_on: string | null;
    completed: boolean;
    description: string;
    assignees: { id: number; name: string }[];
    app_url: string;
}

/** Check if Basecamp credentials are configured */
export function isBasecampConfigured(): boolean {
    return !!(process.env.BASECAMP_ACCESS_TOKEN && process.env.BASECAMP_ACCOUNT_ID);
}

/**
 * Parse the `Link` header returned by Basecamp to find the next page URL.
 * Format: <https://...>; rel="next", <https://...>; rel="last"
 */
function parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
}

/** List ALL active Basecamp projects, following pagination automatically. */
export async function listBasecampProjects(): Promise<BasecampProject[]> {
    const all: BasecampProject[] = [];
    let url: string | null = `${BASE_URL()}/projects.json`;

    try {
        while (url) {
            const res = await basecampFetch(url);
            if (!res.ok) throw new Error(`Basecamp projects fetch failed: ${res.status}`);
            const page = await res.json() as BasecampProject[];
            all.push(...page);
            url = parseNextLink(res.headers.get('Link'));
        }
        return all.filter(p => p.status === 'active');
    } catch (err) {
        console.error('[Basecamp] listProjects error:', err);
        return all.filter(p => p.status === 'active'); // return whatever we got before failure
    }
}

/**
 * Fetch all todolists from a single todoset, following pagination.
 */
async function fetchTodolistsFromTodoset(projectId: number | string, todosetId: string): Promise<BasecampTodolist[]> {
    const results: BasecampTodolist[] = [];
    let url: string | null = `${BASE_URL()}/buckets/${projectId}/todosets/${todosetId}/todolists.json`;
    while (url) {
        const res = await basecampFetch(url);
        if (!res.ok) break;
        const page = await res.json() as BasecampTodolist[];
        results.push(...page);
        url = parseNextLink(res.headers.get('Link'));
    }
    return results;
}

/**
 * List all todolists for a project across ALL camps/todosets.
 * Basecamp projects can have multiple todosets (one per camp/group).
 * The dock lists every todoset — we fetch from all of them and combine.
 */
export async function listBasecampTodolists(projectId: number | string): Promise<BasecampTodolist[]> {
    try {
        const projectRes = await basecampFetch(`${BASE_URL()}/projects/${projectId}.json`);
        if (!projectRes.ok) throw new Error(`Basecamp project fetch failed: ${projectRes.status}`);
        const project = await projectRes.json() as { dock: Array<{ name: string; enabled: boolean; url: string }> };

        // Find ALL enabled todosets (one per camp — projects can have many)
        const todosetDocks = (project.dock ?? []).filter(d => d.name === 'todoset' && d.enabled);
        if (todosetDocks.length === 0) return [];

        // Step 2: fetch todolists from every todoset in parallel
        const perTodoset = await Promise.all(
            todosetDocks.map(dock => {
                const todosetId = dock.url.split('/todosets/')[1]?.replace('.json', '');
                return todosetId ? fetchTodolistsFromTodoset(projectId, todosetId) : Promise.resolve([]);
            }),
        );
        return perTodoset.flat();
    } catch (err) {
        console.error('[Basecamp] listTodolists error:', err);
        return [];
    }
}

/** List all todos for a todolist, following pagination. Excludes completed by default. */
export async function listBasecampTodos(
    projectId: number | string,
    todolistId: number | string,
    includeCompleted = false,
): Promise<BasecampTodoFull[]> {
    const results: BasecampTodoFull[] = [];
    let url: string | null = `${BASE_URL()}/buckets/${projectId}/todolists/${todolistId}/todos.json`;
    try {
        while (url) {
            const res = await basecampFetch(url);
            if (!res.ok) break;
            const page = await res.json() as BasecampTodoFull[];
            results.push(...page);
            url = parseNextLink(res.headers.get('Link'));
        }
        return includeCompleted ? results : results.filter(t => !t.completed);
    } catch (err) {
        console.error('[Basecamp] listTodos error:', err);
        return results.filter(t => includeCompleted || !t.completed);
    }
}

/** Create a todo in a Basecamp todolist. Returns the new todo's ID and app URL. */
export async function createBasecampTodo(
    projectId: number | string,
    todolistId: number | string,
    params: {
        content: string;
        dueOn?: string;       // YYYY-MM-DD
        description?: string;
        assigneePersonIds?: number[];
    },
): Promise<{ id: number; appUrl: string } | null> {
    try {
        const body: Record<string, unknown> = { content: params.content };
        if (params.dueOn) body.due_on = params.dueOn;
        if (params.description) body.description = params.description;
        if (params.assigneePersonIds?.length) body.assignee_ids = params.assigneePersonIds;

        const res = await basecampFetch(
            `${BASE_URL()}/buckets/${projectId}/todolists/${todolistId}/todos.json`,
            { method: 'POST', body: JSON.stringify(body) },
        );
        if (!res.ok) throw new Error(`Basecamp createTodo failed: ${res.status} ${await res.text()}`);
        const todo = await res.json() as BasecampTodo;
        return { id: todo.id, appUrl: todo.app_url };
    } catch (err) {
        console.error('[Basecamp] createTodo error:', err);
        return null;
    }
}

/** Fetch a single Basecamp todo (includes current assignees with their IDs). */
export async function getBasecampTodo(
    projectId: number | string,
    todoId: number | string,
): Promise<BasecampTodoFull | null> {
    try {
        const res = await basecampFetch(
            `${BASE_URL()}/buckets/${projectId}/todos/${todoId}.json`,
        );
        if (!res.ok) return null;
        return await res.json() as BasecampTodoFull;
    } catch (err) {
        console.error('[Basecamp] getTodo error:', err);
        return null;
    }
}

/** Update the due date on a Basecamp todo. Pass null to clear it. */
export async function updateBasecampTodoDueDate(
    projectId: number | string,
    todoId: number | string,
    dueOn: string | null,
): Promise<boolean> {
    try {
        const res = await basecampFetch(
            `${BASE_URL()}/buckets/${projectId}/todos/${todoId}.json`,
            { method: 'PATCH', body: JSON.stringify({ due_on: dueOn }) },
        );
        return res.ok;
    } catch (err) {
        console.error('[Basecamp] updateTodoDueDate error:', err);
        return false;
    }
}

/**
 * Add assignees to a Basecamp todo without removing existing ones.
 * Fetches current assignees first, merges, then PATCHes — so people assigned
 * directly in Basecamp (e.g. Mike) are never removed by SEO PM changes.
 */
export async function updateBasecampTodoAssignees(
    projectId: number | string,
    todoId: number | string,
    addPersonIds: number[],
): Promise<boolean> {
    try {
        // Fetch current todo to preserve assignees set directly in Basecamp
        const current = await getBasecampTodo(projectId, todoId);
        const existingIds = (current?.assignees ?? []).map(a => a.id);
        const merged = Array.from(new Set([...existingIds, ...addPersonIds]));

        const res = await basecampFetch(
            `${BASE_URL()}/buckets/${projectId}/todos/${todoId}.json`,
            { method: 'PATCH', body: JSON.stringify({ assignee_ids: merged }) },
        );
        return res.ok;
    } catch (err) {
        console.error('[Basecamp] updateTodoAssignees error:', err);
        return false;
    }
}

/** Mark a Basecamp todo as complete */
export async function completeBasecampTodo(
    projectId: number | string,
    todoId: number | string,
): Promise<boolean> {
    try {
        const res = await basecampFetch(
            `${BASE_URL()}/buckets/${projectId}/todos/${todoId}/completion.json`,
            { method: 'POST' },
        );
        return res.ok;
    } catch (err) {
        console.error('[Basecamp] completeTodo error:', err);
        return false;
    }
}

/** Reopen (un-complete) a Basecamp todo */
export async function reopenBasecampTodo(
    projectId: number | string,
    todoId: number | string,
): Promise<boolean> {
    try {
        const res = await basecampFetch(
            `${BASE_URL()}/buckets/${projectId}/todos/${todoId}/completion.json`,
            { method: 'DELETE' },
        );
        return res.ok;
    } catch (err) {
        console.error('[Basecamp] reopenTodo error:', err);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Timesheets — https://github.com/basecamp/bc-api/blob/master/sections/timesheets.md
// Entries attach to any timesheetable recording (a todo, or the project's own
// timesheet recording). Update/delete use flat /timesheet_entries/{id} routes.
// ---------------------------------------------------------------------------

export interface BasecampTimesheetEntry {
    id: number;
    date: string;
    hours: string;
    description: string;
    app_url: string;
    parent: { id: number; type: string };
    // Present on canonical single-entry reads; used by inbound ledger import.
    updated_at?: string;
    bucket?: { id: number; name?: string };
    creator?: { id: number; name?: string };
}

/**
 * Read one timesheet entry as canonical provider state, for inbound import.
 *
 * The three-way return is load-bearing: 'missing' means Basecamp confirmed the
 * entry is gone (void the ledger row), 'unavailable' means we could not ask
 * (retry the delivery). Collapsing them would let an outage erase real time.
 */
export async function getBasecampTimesheetEntryState(
    projectId: number | string,
    entryId: number | string,
): Promise<ProviderTimesheetEntry | 'missing' | 'unavailable'> {
    let raw: BasecampTimesheetEntry | null = null;
    try {
        const eid = safeId(entryId, 'entryId');
        const res = await basecampFetch(`${BASE_URL()}/timesheet_entries/${eid}.json`);
        if (res.status === 404 || res.status === 403) return 'missing';
        if (res.ok) {
            raw = await res.json() as BasecampTimesheetEntry;
        } else if (res.status >= 500 || res.status === 429) {
            return 'unavailable';
        }
    } catch (err) {
        console.error('[Basecamp] getTimesheetEntryState error:', err);
        return 'unavailable';
    }

    // Some accounts only expose the entry through the project collection.
    if (!raw) {
        try {
            raw = await getBasecampProjectTimesheetEntry(projectId, entryId);
        } catch {
            return 'unavailable';
        }
        if (!raw) return 'missing';
    }

    const bucketId = raw.bucket?.id ?? Number(projectId);
    const creatorId = raw.creator?.id;
    if (!raw.parent?.id || !creatorId || !Number.isFinite(bucketId)) return 'unavailable';

    const hours = Number(raw.hours);
    return {
        id: String(raw.id),
        date: raw.date,
        hours: Number.isFinite(hours) ? hours : 0,
        description: raw.description ?? '',
        updatedAt: raw.updated_at ?? '',
        bucketId: String(bucketId),
        parentId: String(raw.parent.id),
        parentType: raw.parent.type,
        creatorId: String(creatorId),
    };
}

/** Fetch a project's timesheet availability. */
export async function getBasecampProjectTimesheetEnabled(projectId: number | string): Promise<boolean | null> {
    try {
        const pid = safeId(projectId, 'projectId');
        const res = await basecampFetch(`${BASE_URL()}/projects/${pid}.json`);
        if (!res.ok) return null;
        const project = await res.json() as { timesheet_enabled?: boolean };
        return project.timesheet_enabled ?? false;
    } catch (err) {
        console.error('[Basecamp] getProjectTimesheetEnabled error:', err);
        return null;
    }
}

/**
 * Find the recording ID of a project's own timesheet, for logging time at the
 * project level (not attached to a todo). The timesheet doesn't appear in the
 * project's dock — the documented way to find it is via existing entries whose
 * parent type is "Timesheet". Returns null if it can't be determined yet
 * (e.g. the Basecamp timesheet has no project-level entries).
 */
export async function findProjectTimesheetRecordingId(projectId: number | string): Promise<number | null> {
    try {
        const pid = safeId(projectId, 'projectId');
        // Some Basecamp accounts do expose the timesheet in the dock — check first.
        const projectRes = await basecampFetch(`${BASE_URL()}/projects/${pid}.json`);
        if (projectRes.ok) {
            const project = await projectRes.json() as { dock?: Array<{ id: number; name: string; enabled: boolean }> };
            const timesheetDock = (project.dock ?? []).find(d => d.name === 'timesheet' && d.enabled);
            if (timesheetDock) return timesheetDock.id;
        }

        let url: string | null = `${BASE_URL()}/projects/${pid}/timesheet.json`;
        const seen = new Set<string>();
        while (url) {
            seen.add(url);
            const res = await basecampFetch(url);
            if (!res.ok) return null;
            const page = await res.json() as BasecampTimesheetEntry[];
            const projectLevel = page.find(e => e.parent?.type === 'Timesheet');
            if (projectLevel) return projectLevel.parent.id;
            url = nextPageUrl(res.headers.get('Link'), seen);
        }
        return null;
    } catch (err) {
        console.error('[Basecamp] findProjectTimesheetRecordingId error:', err);
        return null;
    }
}

/** Find an entry through the project-scoped timesheet collection. */
export async function getBasecampProjectTimesheetEntry(
    projectId: number | string,
    entryId: number | string,
): Promise<BasecampTimesheetEntry | null> {
    try {
        const pid = safeId(projectId, 'projectId');
        const eid = safeId(entryId, 'entryId');
        let url: string | null = `${BASE_URL()}/projects/${pid}/timesheet.json`;
        const seen = new Set<string>();
        while (url) {
            seen.add(url);
            const response = await basecampFetch(url);
            if (!response.ok) return null;
            const page = await response.json() as BasecampTimesheetEntry[];
            const entry = page.find(candidate => String(candidate.id) === eid);
            if (entry) return entry;
            url = nextPageUrl(response.headers.get('Link'), seen);
        }
        return null;
    } catch (error) {
        console.error('[Basecamp] getProjectTimesheetEntry error:', error);
        return null;
    }
}

/**
 * List a project's timesheet entries so a lost create response can be recovered
 * from provider provenance instead of writing a duplicate entry. Paging is
 * capped because this only ever runs on a retry after a failed sync.
 */
export async function listBasecampProjectTimesheetEntries(
    projectId: number | string,
    maxPages = 10,
): Promise<BasecampTimesheetEntry[]> {
    try {
        const pid = safeId(projectId, 'projectId');
        const entries: BasecampTimesheetEntry[] = [];
        const seen = new Set<string>();
        let url: string | null = `${BASE_URL()}/projects/${pid}/timesheet.json`;
        for (let page = 0; url && page < maxPages; page += 1) {
            seen.add(url);
            const res: Response = await basecampFetch(url);
            if (!res.ok) return entries;
            entries.push(...await res.json() as BasecampTimesheetEntry[]);
            url = nextPageUrl(res.headers.get('Link'), seen);
        }
        return entries;
    } catch (err) {
        console.error('[Basecamp] listProjectTimesheetEntries error:', err);
        return [];
    }
}

/**
 * List a project's timesheet entry ids and dates for reconciliation.
 *
 * Returns 'unavailable' rather than an empty list on failure — an empty sweep
 * and a failed sweep must not look the same to the caller.
 */
export async function listBasecampTimesheetEntryStubs(
    projectId: number | string,
    maxPages = 20,
): Promise<{ id: string; date: string }[] | 'unavailable'> {
    try {
        const pid = safeId(projectId, 'projectId');
        const stubs: { id: string; date: string }[] = [];
        const seen = new Set<string>();
        let url: string | null = `${BASE_URL()}/projects/${pid}/timesheet.json`;
        for (let page = 0; url && page < maxPages; page += 1) {
            seen.add(url);
            const res: Response = await basecampFetch(url);
            if (!res.ok) return 'unavailable';
            const entries = await res.json() as BasecampTimesheetEntry[];
            stubs.push(...entries.map(entry => ({ id: String(entry.id), date: entry.date })));
            url = nextPageUrl(res.headers.get('Link'), seen);
        }
        return stubs;
    } catch (err) {
        console.error('[Basecamp] listTimesheetEntryStubs error:', err);
        return 'unavailable';
    }
}

/** Create a timesheet entry under a recording (todo or project timesheet). */
export async function createBasecampTimesheetEntry(
    recordingId: number | string,
    params: {
        date: string;         // YYYY-MM-DD
        hours: number;        // decimal hours
        description?: string;
        personId?: number;    // defaults to the authenticated Basecamp user
    },
): Promise<{ id: number; appUrl: string } | null> {
    try {
        const body: Record<string, unknown> = { date: params.date, hours: String(params.hours) };
        if (params.description) body.description = params.description;
        if (params.personId) body.person_id = params.personId;

        const res = await basecampFetch(
            `${BASE_URL()}/recordings/${safeId(recordingId, 'recordingId')}/timesheet/entries.json`,
            { method: 'POST', body: JSON.stringify(body) },
        );
        if (!res.ok) throw new Error(`Basecamp createTimesheetEntry failed: ${res.status} ${await res.text()}`);
        const entry = await res.json() as BasecampTimesheetEntry;
        return { id: entry.id, appUrl: entry.app_url };
    } catch (err) {
        console.error('[Basecamp] createTimesheetEntry error:', err);
        return null;
    }
}

/** Update a timesheet entry. Returns 'not_found' when it was deleted in Basecamp. */
export async function updateBasecampTimesheetEntry(
    entryId: number | string,
    patch: { date?: string; hours?: number; description?: string; personId?: number },
): Promise<'ok' | 'not_found' | 'error'> {
    try {
        const body: Record<string, unknown> = {};
        if (patch.date !== undefined) body.date = patch.date;
        if (patch.hours !== undefined) body.hours = String(patch.hours);
        if (patch.description !== undefined) body.description = patch.description;
        if (patch.personId) body.person_id = patch.personId;

        const res = await basecampFetch(
            `${BASE_URL()}/timesheet_entries/${safeId(entryId, 'entryId')}.json`,
            { method: 'PUT', body: JSON.stringify(body) },
        );
        if (res.status === 404) return 'not_found';
        return res.ok ? 'ok' : 'error';
    } catch (err) {
        console.error('[Basecamp] updateTimesheetEntry error:', err);
        return 'error';
    }
}

/** Delete a timesheet entry. Treats an already-deleted entry as success. */
export async function deleteBasecampTimesheetEntry(entryId: number | string): Promise<boolean> {
    try {
        const res = await basecampFetch(
            `${BASE_URL()}/timesheet_entries/${safeId(entryId, 'entryId')}.json`,
            { method: 'DELETE' },
        );
        return res.ok || res.status === 404;
    } catch (err) {
        console.error('[Basecamp] deleteTimesheetEntry error:', err);
        return false;
    }
}

/** Post a comment on a Basecamp todo */
export async function createBasecampComment(
    projectId: number | string,
    todoId: number | string,
    content: string,
): Promise<number | null> {
    try {
        const res = await basecampFetch(
            `${BASE_URL()}/buckets/${projectId}/recordings/${todoId}/comments.json`,
            { method: 'POST', body: JSON.stringify({ content }) },
        );
        if (!res.ok) throw new Error(`Basecamp createComment failed: ${res.status}`);
        const comment = await res.json() as { id: number };
        return comment.id;
    } catch (err) {
        console.error('[Basecamp] createComment error:', err);
        return null;
    }
}
