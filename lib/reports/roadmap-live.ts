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

const APPROVED = new Set(['approved', 'scheduled', 'sent']);

export interface ApprovedReportRoadmapInput {
    state: string;
    organizationId: string;
    clientId: string;
    /** Frozen report. Included so a caller can see it is not the source. */
    snapshot: unknown;
    /**
     * Settings from this report's Roadmap block.
     * Null means the block is missing or the report row could not be read.
     */
    blockProps: unknown | null;
}

/**
 * Approved, scheduled, and sent reports show the live plan.
 * A draft, a missing block, or a failed report read returns null and does not
 * load tasks. Hidden stages and hidden descriptions are removed here.
 */
export async function readApprovedReportRoadmap(
    report: ApprovedReportRoadmapInput,
    deps: {
        today: string;
        loadTasks: (organizationId: string, clientId: string) => Promise<StageListTask[] | null>;
        loadBoard: (organizationId: string, clientId: string) => Promise<PlanBoard>;
    },
): Promise<ClientRoadmap | null> {
    void report.snapshot;
    if (report.blockProps == null) return null;
    if (!APPROVED.has(report.state)) return null;
    const [tasks, board] = await Promise.all([
        deps.loadTasks(report.organizationId, report.clientId),
        deps.loadBoard(report.organizationId, report.clientId),
    ]);
    if (tasks == null) return null;
    return presentRoadmap(
        projectClientRoadmap({ board, tasks, today: deps.today }),
        readRoadmapBlockOptions(report.blockProps),
    );
}
