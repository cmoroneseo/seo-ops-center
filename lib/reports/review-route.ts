/**
 * Staff review API. Ids come from the loaded report and the signed-in member.
 * The request body can name an action and a note. It cannot name an org, a
 * client, a user, or a role.
 */

import type { ReportAccess } from './access';
import type { ReportRow } from './reportStore';
import { copySourcesForMetrics } from './copy-rules';
import { evaluatePresendChecks, type GscReadout, type PresendResult, type SourceHealth } from './presend-checks';
import {
    assembleReportSnapshot,
    contentHash,
    copyTextForSnapshot,
    type FrozenLedgerRow,
    type GscDayInput,
    type MetricInput,
    type ReportVersionSnapshot,
} from './versions';
import {
    closeCard,
    emptyReview,
    ownerApprovalPending,
    planReviewAction,
    type Actor,
    type PlanSuccess,
    type ReviewActionName,
    type ReviewRecord,
} from './workflow';

const ACTIONS: ReviewActionName[] = ['submit', 'approve', 'correct', 'schedule', 'unschedule'];

export interface VersionListItem {
    id: string;
    versionNo: number;
    reason: 'approval' | 'correction';
    correctionNote: string | null;
    amNote: string | null;
    contentHash: string;
    createdAt: string;
    createdBy: string | null;
}

export interface ReviewContext {
    clientCreatedAt: string | null;
    reportCount: number;
    review: ReviewRecord;
    hasRecipient: boolean;
    recipientContactId: string | null;
    sources: SourceHealth[];
    gsc: GscReadout;
    gscDays: GscDayInput[];
    hours: number;
    tasksCompleted: number;
    shipped: number;
    missingProofCount: number;
    rankChecks: { position: number | null }[];
    metrics: MetricInput[];
    versions: VersionListItem[];
}

export interface PersistInput {
    reportId: string;
    organizationId: string;
    clientId: string;
    actorId: string;
    fromExists: boolean;
    fromState: ReviewRecord['state'];
    plan: PlanSuccess;
    amNote: string | null;
    snapshot: ReportVersionSnapshot | null;
    contentHash: string | null;
    now: string;
}

export interface ReviewRouteDeps {
    access: (id: unknown, mode: 'read' | 'write') => Promise<ReportAccess>;
    loadContext: (report: ReportRow) => Promise<{ ok: true; context: ReviewContext } | { ok: false; status: number; error: string }>;
    loadLedger: (organizationId: string, clientId: string, now: Date) => Promise<FrozenLedgerRow[]>;
    loadPlan: (organizationId: string, clientId: string) => Promise<Record<string, unknown> | null>;
    persist: (input: PersistInput) => Promise<{ ok: true; versionId: string | null } | { ok: false; status: number; error: string }>;
    readSnapshot: (reportId: string, organizationId: string, versionNo: number) => Promise<ReportVersionSnapshot | null>;
    now: () => Date;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function actorFrom(auth: Extract<ReportAccess, { ok: true }>['auth']): Actor {
    return { userId: auth.userId, role: auth.role };
}

function present(report: ReportRow, context: ReviewContext, checks: PresendResult, now: Date, actor: Actor) {
    const pending = ownerApprovalPending(context.review);
    const open = context.review.state === 'draft' || (context.review.state === 'ready_for_review' && !pending);
    const card = closeCard({
        reportId: report.id,
        clientId: report.client_id ?? '',
        reportMonth: report.report_month,
        state: context.review.state,
        gscConnected: context.gsc.connected,
        hasRecipient: context.hasRecipient,
        requiresOwnerApproval: context.review.exists ? context.review.requiresOwnerApproval : false,
        ownerApprovalPending: pending,
        checks: checks.checks,
    });
    return {
        review: {
            state: context.review.state,
            exists: context.review.exists,
            requiresOwnerApproval: context.review.requiresOwnerApproval,
            amApprovedBy: context.review.amApprovedBy,
            ownerApprovedBy: context.review.ownerApprovedBy,
            currentVersionId: context.review.currentVersionId,
            scheduledFor: context.review.scheduledFor,
            sentAt: context.review.sentAt,
            ownerApprovalPending: pending,
            schedulingWaitsForRecipient: !context.hasRecipient,
        },
        checks: checks.checks,
        banners: checks.banners,
        canApprove: pending ? actor.role === 'owner' : open && actor.role !== 'viewer' && checks.canApprove,
        canSchedule: context.review.state === 'approved' && checks.canSchedule,
        versions: context.versions,
        close: card,
        checkedAt: now.toISOString(),
    };
}

function checksFor(report: ReportRow, context: ReviewContext, note: string | null, now: Date): PresendResult {
    const current = Object.fromEntries(context.metrics
        .filter(row => row.metricMonth === report.report_month)
        .map(row => [row.source, row.data ?? {}]));
    const copy = copyTextForSnapshot({
        executiveSummary: report.executive_summary ?? '',
        recommendations: report.recommendations ?? '',
        amNote: note,
        sections: report.sections,
    });
    return evaluatePresendChecks({
        reportMonth: report.report_month,
        now,
        gsc: context.gsc,
        sources: context.sources,
        rankChecks: context.rankChecks,
        hours: context.hours,
        tasksCompleted: context.tasksCompleted,
        shipped: context.shipped,
        missingProofCount: context.missingProofCount,
        copyText: copy.text,
        copySources: copySourcesForMetrics(current),
        amNote: note,
        hasRecipient: context.hasRecipient,
    });
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
    try {
        const body = await request.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request' }, 400);
        return body as Record<string, unknown>;
    } catch {
        return json({ error: 'Invalid JSON' }, 400);
    }
}

export function createReviewHandlers(deps: ReviewRouteDeps) {
    return {
        async get(id: string, request: Request) {
            const access = await deps.access(id, 'read');
            if (!access.ok) return json({ error: access.error }, access.status);
            const report = access.report;
            if (!report.client_id) return json({ review: null, checks: [], banners: [], versions: [], close: null });

            const versionParam = new URL(request.url).searchParams.get('version');
            if (versionParam != null) {
                if (!/^[1-9]\d*$/.test(versionParam)) return json({ error: 'Invalid version' }, 400);
                const snapshot = await deps.readSnapshot(report.id, report.organization_id, Number(versionParam));
                if (!snapshot) return json({ error: 'Not found' }, 404);
                return json({ snapshot });
            }

            const loaded = await deps.loadContext(report);
            if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
            const now = deps.now();
            return json(present(report, loaded.context, checksFor(report, loaded.context, null, now), now, actorFrom(access.auth)));
        },

        async post(id: string, request: Request) {
            const access = await deps.access(id, 'write');
            if (!access.ok) return json({ error: access.error }, access.status);
            const report = access.report;
            if (!report.client_id) return json({ error: 'Assign a client before approving.' }, 409);

            const body = await readJson(request);
            if (body instanceof Response) return body;
            const action = body.action;
            if (typeof action !== 'string' || !ACTIONS.includes(action as ReviewActionName)) {
                return json({ error: 'Invalid action' }, 400);
            }
            const note = typeof body.note === 'string' ? body.note.trim() : null;
            if (note && note.length > 2000) return json({ error: 'Keep the note under 2000 characters.' }, 400);

            const loaded = await deps.loadContext(report);
            if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
            const now = deps.now();
            const context = loaded.context;
            const amNote = action === 'approve' || action === 'correct' ? note : null;
            const checks = checksFor(report, context, amNote, now);
            const planned = planReviewAction({
                review: context.review,
                action: action as ReviewActionName,
                actor: actorFrom(access.auth),
                note,
                hasRecipient: context.hasRecipient,
                recipientContactId: context.recipientContactId,
                clientCreatedAt: context.clientCreatedAt,
                reportCount: context.reportCount,
                reportMonth: report.report_month,
                now,
                checksPass: checks.canApprove,
            });
            if (!planned.ok) return json({ error: planned.error, checks: checks.checks, banners: checks.banners }, planned.status);

            let snapshot: ReportVersionSnapshot | null = null;
            let hash: string | null = null;
            if (planned.capture) {
                let ledger: FrozenLedgerRow[] = [];
                let planSnapshot: Record<string, unknown> | null = null;
                try {
                    [ledger, planSnapshot] = await Promise.all([
                        deps.loadLedger(report.organization_id, report.client_id, now),
                        deps.loadPlan(report.organization_id, report.client_id),
                    ]);
                } catch {
                    return json({ error: 'Could not freeze the report.' }, 500);
                }
                snapshot = assembleReportSnapshot({
                    reportId: report.id,
                    organizationId: report.organization_id,
                    clientId: report.client_id,
                    reportMonth: report.report_month,
                    title: report.title,
                    executiveSummary: report.executive_summary ?? '',
                    recommendations: report.recommendations ?? '',
                    sections: report.sections,
                    capturedAt: now.toISOString(),
                    reason: planned.reason ?? 'approval',
                    correctionNote: action === 'correct' ? note : null,
                    amNote,
                    metrics: context.metrics,
                    gscDays: context.gscDays,
                    gscFinal: context.gsc.final,
                    ledgerRows: ledger,
                    planSnapshot,
                });
                hash = contentHash(snapshot);
            }

            const saved = await deps.persist({
                reportId: report.id,
                organizationId: report.organization_id,
                clientId: report.client_id,
                actorId: access.auth.userId,
                fromExists: context.review.exists,
                fromState: context.review.state,
                plan: planned,
                amNote,
                snapshot,
                contentHash: hash,
                now: now.toISOString(),
            });
            if (!saved.ok) return json({ error: saved.error }, saved.status);
            return json({
                ...present(report, {
                    ...context,
                    review: {
                        ...context.review,
                        exists: true,
                        state: planned.toState,
                        requiresOwnerApproval: planned.requiresOwnerApproval,
                        amApprovedBy: planned.amApprovedBy,
                        ownerApprovedBy: planned.ownerApprovedBy,
                        currentVersionId: saved.versionId,
                        scheduledFor: planned.scheduledFor,
                        sentAt: planned.sentAt,
                    },
                }, checks, now, actorFrom(access.auth)),
                versionId: saved.versionId,
            });
        },
    };
}

export function reviewContext(patch: Partial<ReviewContext> = {}): ReviewContext {
    return {
        clientCreatedAt: '2024-01-01T00:00:00.000Z',
        reportCount: 5,
        review: emptyReview(),
        hasRecipient: false,
        recipientContactId: null,
        sources: [
            { source: 'gsc', connected: true, errored: false, lastSyncedAt: '2026-10-08T16:00:00.000Z' },
        ],
        gsc: { connected: true, final: true, clicks: 65, impressions: 100, lastSyncedAt: '2026-10-08T16:00:00.000Z', errored: false },
        gscDays: [{ date: '2026-09-01', isIncomplete: false, property: { clicks: 65, impressions: 100 } }],
        hours: 2,
        tasksCompleted: 0,
        shipped: 0,
        missingProofCount: 0,
        rankChecks: [],
        metrics: [{
            source: 'gsc',
            metricMonth: '2026-09',
            data: { organic_clicks: 65, impressions: 100 },
            provenance: { finality: { final: true } },
            sourceType: 'auto',
            updatedAt: '2026-10-08T16:00:00.000Z',
        }],
        versions: [],
        ...patch,
    };
}
