/**
 * Live roadmap for an approved report.
 * The frozen checklist is not the source. Block settings are applied here,
 * before the result can be passed to a browser component.
 */

import type { PlanBoard } from '../seo-plan/plan-phases';
import type { StageListTask } from '../seo-plan/stage-list';
import {
    presentRoadmap,
    projectClientRoadmap,
    readRoadmapBlockOptions,
    type ClientRoadmap,
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
 * Hidden stages and hidden descriptions are removed here.
 */
export async function readSharedReportRoadmap(
    report: SharedReportRoadmapInput,
    deps: {
        today: string;
        loadTasks: (organizationId: string, clientId: string) => Promise<StageListTask[] | null>;
        loadBoard: (organizationId: string, clientId: string) => Promise<PlanBoard>;
    },
): Promise<ClientRoadmap | null> {
    try {
        if (report.share !== 'ok') return null;
        const props = blockPropsFromSections(report.sections);
        if (props == null) return null;
        const [tasks, board] = await Promise.all([
            deps.loadTasks(report.organizationId, report.clientId),
            deps.loadBoard(report.organizationId, report.clientId),
        ]);
        if (tasks == null) return null;
        return presentRoadmap(
            projectClientRoadmap({ board, tasks, today: deps.today }),
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
