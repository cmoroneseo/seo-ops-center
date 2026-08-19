/**
 * Planner display preferences.
 *
 * These are per-person, per-device and affect nothing but how the grid is drawn,
 * so they live in localStorage rather than costing a table and a migration. If
 * they ever need to follow a user between machines, move them to a
 * `planner_preferences` row — the shape below is the migration.
 */

export interface PlannerPreferences {
    /** Sun = 0, Mon = 1. */
    weekStartsOn: 0 | 1;
    showWeekends: boolean;
    /** First and last hour drawn on the grid. */
    dayStartHour: number;
    dayEndHour: number;
    /** The working day, shaded lighter than the hours around it. */
    workDayStartHour: number;
    workDayEndHour: number;
    /** Roll overdue tasks into today's column instead of only the sidebar. */
    rollOverdueIntoToday: boolean;
    /**
     * Basecamp projects for internal time. Internal work has no client, so it
     * has no client config to resolve a destination from — you pick one of your
     * personal/HQ projects instead.
     *
     * Recents are keyed by organization so switching tenants cannot carry a
     * project ID from one organization's authorized catalog into another.
     */
    recentBasecampProjectsByOrganization: Record<string, { id: string; name: string }[]>;
}

/** How many regulars the picker pins before falling back to search. */
export const MAX_RECENT_PROJECTS = 5;

/** Move a project to the front of the recents list, de-duplicated and capped. */
export function withRecentProject(
    prefs: PlannerPreferences,
    organizationId: string,
    project: { id: string; name: string },
): PlannerPreferences {
    const recents = prefs.recentBasecampProjectsByOrganization[organizationId] ?? [];
    const rest = recents.filter(p => p.id !== project.id);
    return {
        ...prefs,
        recentBasecampProjectsByOrganization: {
            ...prefs.recentBasecampProjectsByOrganization,
            [organizationId]: [project, ...rest].slice(0, MAX_RECENT_PROJECTS),
        },
    };
}

export function recentProjectsForOrganization(
    prefs: PlannerPreferences,
    organizationId: string | null | undefined,
): { id: string; name: string }[] {
    if (!organizationId) return [];
    return prefs.recentBasecampProjectsByOrganization[organizationId] ?? [];
}

export const DEFAULT_PREFERENCES: PlannerPreferences = {
    weekStartsOn: 0,
    showWeekends: true,
    dayStartHour: 7,
    dayEndHour: 20,
    workDayStartHour: 9,
    workDayEndHour: 17,
    rollOverdueIntoToday: true,
    recentBasecampProjectsByOrganization: {},
};

const STORAGE_KEY = 'planner:preferences';

/** Clamp anything a hand-edited localStorage value could get wrong. */
export function sanitizePreferences(raw: Partial<PlannerPreferences>): PlannerPreferences {
    const merged = { ...DEFAULT_PREFERENCES, ...raw };
    const dayStart = Math.min(23, Math.max(0, Math.round(merged.dayStartHour)));
    const dayEnd = Math.min(24, Math.max(dayStart + 1, Math.round(merged.dayEndHour)));
    const workStart = Math.min(23, Math.max(0, Math.round(merged.workDayStartHour)));
    const workEnd = Math.min(24, Math.max(workStart + 1, Math.round(merged.workDayEndHour)));
    return {
        weekStartsOn: merged.weekStartsOn === 1 ? 1 : 0,
        showWeekends: Boolean(merged.showWeekends),
        dayStartHour: dayStart,
        dayEndHour: dayEnd,
        workDayStartHour: workStart,
        workDayEndHour: workEnd,
        rollOverdueIntoToday: Boolean(merged.rollOverdueIntoToday),
        recentBasecampProjectsByOrganization: Object.fromEntries(
            Object.entries(merged.recentBasecampProjectsByOrganization ?? {})
                .filter(([organizationId, projects]) => organizationId.length > 0 && Array.isArray(projects))
                .map(([organizationId, projects]) => [
                    organizationId,
                    projects
                        .filter(project => project
                            && typeof project.id === 'string'
                            && typeof project.name === 'string')
                        .slice(0, MAX_RECENT_PROJECTS),
                ]),
        ),
    };
}

export function loadPreferences(): PlannerPreferences {
    if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_PREFERENCES;
        return sanitizePreferences(JSON.parse(raw));
    } catch {
        // A corrupt value must not take the page down with it.
        return DEFAULT_PREFERENCES;
    }
}

export function savePreferences(prefs: PlannerPreferences): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizePreferences(prefs)));
    } catch {
        // Private browsing / quota — the in-memory value still applies this session.
    }
}
