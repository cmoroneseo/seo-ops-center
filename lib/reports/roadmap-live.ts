/**
 * Live roadmap reads. The approved report and the public token both ignore
 * any frozen checklist. The public read names its client from the link row.
 */

import { shareLinkDenial, tokensMatch, hashToken, type ShareLinkDenial } from '../approvals/token';
import type { PlanBoard } from '../seo-plan/plan-phases';
import type { StageListTask } from '../seo-plan/stage-list';
import {
    presentRoadmap,
    projectClientRoadmap,
    readRoadmapBlockOptions,
    type ClientRoadmap,
} from './roadmap';

const APPROVED = new Set(['approved', 'scheduled', 'sent']);

export interface PublicReportLink {
    tokenHash: string;
    revokedAt: string | null;
    expiresAt: string | null;
    organizationId: string;
    clientId: string;
    reportId: string;
}

export interface PublicRoadmapDeps {
    now: () => Date;
    today: string;
    findLink: (hash: string) => Promise<PublicReportLink | null>;
    loadTasks: (organizationId: string, clientId: string) => Promise<StageListTask[] | null>;
    loadBoard: (organizationId: string, clientId: string) => Promise<PlanBoard>;
    /** Null when this report has no roadmap block. An object means the block is on the report. */
    loadBlockProps: (organizationId: string, clientId: string, reportId: string) => Promise<unknown>;
}

export type PublicRoadmapResult =
    | { ok: true; roadmap: ClientRoadmap | null }
    | { ok: false; denial: ShareLinkDenial };

/**
 * A public report link. A wrong, revoked, or expired token loads nothing.
 * Tasks are read only for the organization and client stored on the link.
 */
export async function readPublicRoadmap(token: string, deps: PublicRoadmapDeps): Promise<PublicRoadmapResult> {
    const link = await deps.findLink(hashToken(token));
    if (!link || !tokensMatch(token, link.tokenHash)) return { ok: false, denial: 'not_found' };
    const denial = shareLinkDenial(link, deps.now());
    if (denial) return { ok: false, denial };
    const props = await deps.loadBlockProps(link.organizationId, link.clientId, link.reportId);
    if (props == null) return { ok: true, roadmap: null };
    const [tasks, board] = await Promise.all([
        deps.loadTasks(link.organizationId, link.clientId),
        deps.loadBoard(link.organizationId, link.clientId),
    ]);
    const roadmap = projectClientRoadmap({
        board,
        tasks: tasks ?? [],
        today: deps.today,
    });
    return { ok: true, roadmap: presentRoadmap(roadmap, readRoadmapBlockOptions(props)) };
}

export interface ApprovedReportRoadmapInput {
    state: string;
    organizationId: string;
    clientId: string;
    /** Frozen report. Included so a caller can see it is not the source. */
    snapshot: unknown;
}

/**
 * Approved, scheduled, and sent reports show the live plan.
 * The frozen snapshot is not read. A draft does not use this path.
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
    if (!APPROVED.has(report.state)) return null;
    const [tasks, board] = await Promise.all([
        deps.loadTasks(report.organizationId, report.clientId),
        deps.loadBoard(report.organizationId, report.clientId),
    ]);
    if (tasks == null) return null;
    return projectClientRoadmap({ board, tasks, today: deps.today });
}
