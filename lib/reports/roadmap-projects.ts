import type { SupabaseClient } from '@supabase/supabase-js';
import { INITIATIVE_STATES, type InitiativeState } from '../campaign-workspace/initiatives';
import type { RoadmapProject } from './roadmap';

const STATES = new Set<string>(INITIATIVE_STATES);

interface ProjectRow extends RoadmapProject {
    priority: number;
    schedule: string;
}

function day(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const iso = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/** One row as a roadmap project, or null when it is not a usable project. */
export function roadmapProjectFromRow(row: unknown): ProjectRow | null {
    if (!row || typeof row !== 'object') return null;
    const record = row as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!id || !title) return null;
    const state = typeof record.state === 'string' && STATES.has(record.state)
        ? record.state as InitiativeState
        : 'planned';
    const priority = Number(record.priority);
    return {
        id,
        title,
        state,
        priority: Number.isFinite(priority) ? priority : 99,
        schedule: day(record.starts_on) ?? day(record.ends_on) ?? '9999-99-99',
    };
}

/**
 * The client's projects in the same order as the Campaign workspace
 * (priority, then start or end date, then title). Only id, title, and state
 * leave this function. A failed read returns no projects, so every task
 * falls into the final group instead of failing the page.
 */
export function orderRoadmapProjects(rows: readonly unknown[]): RoadmapProject[] {
    return rows
        .map(roadmapProjectFromRow)
        .filter((row): row is ProjectRow => row !== null)
        .sort((a, b) => a.priority - b.priority
            || a.schedule.localeCompare(b.schedule)
            || a.title.localeCompare(b.title)
            || a.id.localeCompare(b.id))
        .map(({ id, title, state }) => ({ id, title, state }));
}

export async function loadRoadmapProjects(
    db: SupabaseClient,
    organizationId: string,
    clientId: string,
): Promise<RoadmapProject[]> {
    const { data, error } = await db.from('campaign_initiatives')
        .select('id, title, state, priority, starts_on, ends_on')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId);
    if (error || !Array.isArray(data)) return [];
    return orderRoadmapProjects(data);
}
