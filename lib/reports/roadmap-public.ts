/**
 * No-login roadmap link.
 * The token only proves which report to open. Block options come from the
 * latest approved version, or from the shared report when nothing is approved
 * yet. The editable draft is never read. Task descriptions are removed here
 * even when the report asked to show them.
 */

import type { PlanBoard } from '../seo-plan/plan-phases';
import type { StageListTask } from '../seo-plan/stage-list';
import type { ShareLinkDenial } from '../approvals/token';
import { resolvePublicShare, type PublicShareRow } from './gtm-share';
import {
    readRoadmapBlockOptions,
    type ClientRoadmap,
    type ClientRoadmapTask,
} from './roadmap';
import { readSharedReportRoadmap } from './roadmap-live';

export interface PublicRoadmapScope {
    organizationId: string;
    clientId: string;
    reportId: string;
}

/** Active portal share snapshot, or a lookup that failed. */
export type ShareSource = 'missing' | 'error' | unknown;

/** Current approved version, or a lookup that failed. */
export type FrozenSource = 'missing' | 'error' | { snapshot: unknown; versionId: string | null };

export interface RoadmapShareSources {
    share: ShareSource;
    frozen: FrozenSource;
}

export type PublicRoadmapResult =
    | { ok: true; roadmap: ClientRoadmap }
    | { ok: false; denial: ShareLinkDenial };

/**
 * Sections for the public plan.
 * An approved version is the latest freeze, and a missing roadmap block there
 * does not fall through to an older share or the draft. A share is used only
 * when nothing has been approved. Any database error refuses the plan.
 * Returned sections already hide task descriptions.
 */
export function latestRoadmapSections(sources: RoadmapShareSources): { sections: unknown; versionId: string | null } | null {
    if (sources.share === 'error' || sources.frozen === 'error') return null;
    if (sources.frozen !== 'missing') {
        const prepared = publicRoadmapSections(sectionsFromSnapshot(sources.frozen.snapshot));
        if (!prepared) return null;
        return { sections: prepared, versionId: sources.frozen.versionId };
    }
    if (sources.share !== 'missing') {
        const prepared = publicRoadmapSections(sectionsFromSnapshot(sources.share));
        if (!prepared) return null;
        return { sections: prepared, versionId: null };
    }
    return null;
}

/**
 * Live plan for one roadmap link.
 * Organization, client, and report come from the link row. A wrong kind, a
 * bad token, a revoked or expired link, a missing roadmap block, or a failed
 * read returns a denial and no plan.
 */
export async function readPublicRoadmap(token: string, deps: {
    now?: () => Date;
    today: string;
    findByHash: (hash: string) => Promise<PublicShareRow | null>;
    loadSources: (scope: PublicRoadmapScope) => Promise<RoadmapShareSources | null>;
    loadTasks: (organizationId: string, clientId: string) => Promise<StageListTask[] | null>;
    loadBoard: (organizationId: string, clientId: string) => Promise<PlanBoard>;
}): Promise<PublicRoadmapResult> {
    try {
        const gate = await resolvePublicShare(token, {
            now: deps.now,
            expectedKind: 'roadmap',
            findByHash: deps.findByHash,
        });
        if (!gate.ok || gate.kind !== 'roadmap') {
            return { ok: false, denial: gate.ok ? 'not_found' : gate.denial };
        }
        const sources = await deps.loadSources({
            organizationId: gate.organizationId,
            clientId: gate.clientId,
            reportId: gate.reportId,
        });
        if (!sources) return { ok: false, denial: 'not_found' };
        const picked = latestRoadmapSections(sources);
        if (!picked) return { ok: false, denial: 'not_found' };
        const roadmap = await readSharedReportRoadmap({
            organizationId: gate.organizationId,
            clientId: gate.clientId,
            reportId: gate.reportId,
            sections: picked.sections,
            share: 'ok',
        }, {
            today: deps.today,
            loadTasks: deps.loadTasks,
            loadBoard: deps.loadBoard,
        });
        if (!roadmap) return { ok: false, denial: 'not_found' };
        return { ok: true, roadmap: stripTaskDescriptions(roadmap) };
    } catch {
        return { ok: false, denial: 'not_found' };
    }
}

/** A version snapshot or a portal share, reduced to its section list. */
function sectionsFromSnapshot(value: unknown): unknown | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const portal = record.portal;
    if (portal && typeof portal === 'object' && 'sections' in portal) {
        return (portal as { sections?: unknown }).sections ?? null;
    }
    if ('sections' in record) return record.sections ?? null;
    if (Array.isArray(record.blocks)) return value;
    return null;
}

/**
 * The first roadmap block, with task descriptions forced off.
 * Hidden stages stay as the report saved them.
 */
export function publicRoadmapSections(sections: unknown): unknown | null {
    if (!sections || typeof sections !== 'object' || !('blocks' in sections)) return null;
    const blocks = (sections as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) return null;
    let found = false;
    const next = blocks.map(block => {
        if (found || !block || typeof block !== 'object') return block;
        const type = (block as { type?: unknown }).type;
        if (type !== 'roadmap' && type !== 'marketing_plan') return block;
        found = true;
        const props = (block as { props?: unknown }).props;
        const options = readRoadmapBlockOptions(props);
        const base = props && typeof props === 'object' ? props as Record<string, unknown> : {};
        return {
            ...(block as Record<string, unknown>),
            props: {
                ...base,
                hiddenStages: options.hiddenStages,
                showTaskDescriptions: false,
            },
        };
    });
    if (!found) return null;
    return { ...(sections as Record<string, unknown>), blocks: next };
}

function stripTaskDescriptions(roadmap: ClientRoadmap): ClientRoadmap {
    return {
        stages: roadmap.stages.map(stage => ({
            ...stage,
            tasks: stage.tasks.map(task => {
                const next: ClientRoadmapTask = { title: task.title, status: task.status };
                if (task.doneOn) next.doneOn = task.doneOn;
                return next;
            }),
        })),
    };
}
