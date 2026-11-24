/**
 * Live roadmap for an approved report.
 * The frozen checklist is not the source. Block settings are applied here,
 * before the result can be passed to a browser component.
 */

import type { StageListTask } from '../seo-plan/stage-list';
import {
    presentRoadmap,
    projectClientRoadmap,
    readRoadmapBlockOptions,
    type ClientRoadmap,
    type RoadmapProject,
} from './roadmap';

export type ShareRead = 'ok' | 'missing' | 'error';

export interface SharedReportRoadmapInput {
    organizationId: string;
    clientId: string;
    reportId: string;
    /** Frozen sections from the active portal share. Not the editable draft. */
    sections: unknown;
    /** The active share already checked for this organization, client, and report. */
    share: ShareRead;
}

/**
 * Live plan for a report that is already shared with the client.
 * Permission is that share, not a review record. Block settings come from
 * the shared sections. A failed share lookup, a missing share, a missing
 * block, or a failed task read returns null and does not leak another client's work.
 * Task descriptions follow the shared block settings.
 */
export async function readSharedReportRoadmap(
    report: SharedReportRoadmapInput,
    deps: {
        loadTasks: (organizationId: string, clientId: string) => Promise<StageListTask[] | null>;
        loadProjects: (organizationId: string, clientId: string) => Promise<RoadmapProject[]>;
    },
): Promise<ClientRoadmap | null> {
    try {
        if (report.share !== 'ok') return null;
        const props = blockPropsFromSections(report.sections);
        if (props == null) return null;
        const [tasks, projects] = await Promise.all([
            deps.loadTasks(report.organizationId, report.clientId),
            deps.loadProjects(report.organizationId, report.clientId).catch(() => []),
        ]);
        if (tasks == null) return null;
        return presentRoadmap(
            projectClientRoadmap({ projects, tasks }),
            readRoadmapBlockOptions(props),
        );
    } catch {
        return null;
    }
}

function blockPropsFromSections(sections: unknown): unknown | null {
    if (!sections || typeof sections !== 'object' || !('blocks' in sections)) return null;
    const blocks = (sections as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) return null;
    const block = blocks.find(item => {
        if (!item || typeof item !== 'object') return false;
        const type = (item as { type?: unknown }).type;
        return type === 'roadmap' || type === 'marketing_plan';
    });
    if (!block || typeof block !== 'object') return null;
    return (block as { props?: unknown }).props ?? {};
}
