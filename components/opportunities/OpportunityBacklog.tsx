'use client';

import { useEffect, useMemo, useState } from 'react';
import { TrackQueryButton } from '@/components/keyword-tracking/TrackQueryButton';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { SearchInvestigationActions } from '@/components/workspace/SearchInvestigationActions';
import { investigationTaskHandoff, mapInvestigationsByIdentity } from '@/components/workspace/SearchInsightsTab';
import { insightsRange, loadHistory, loadSearchInsights, type HistoryRow } from '@/lib/gsc/insights';
import { buildInvestigationSnapshot, investigationLookupKey, kindForEvidenceCategory } from '@/lib/gsc/investigations';
import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import { loadTrackedKeywordGsc } from '@/lib/keyword-tracking/gsc-read';
import { loadRankingWindows } from '@/lib/keyword-tracking/rankings';
import type { CannibalizationReport } from '@/lib/keyword-tracking/cannibalization';
import { loadRankings } from '@/lib/keyword-tracking/store';
import {
    formatOpportunityLabel,
    formatOpportunityNumber,
    formatOpportunityText,
    opportunityQueue,
    scoreOpportunities,
    type OpportunityCrawlPage,
    type OpportunityQueue,
    type ScoreOpportunitiesInput,
    type ScoredOpportunity,
} from '@/lib/opportunities/score';
import { getSearchInvestigations, setSearchInvestigationDecision } from '@/lib/supabase/search-investigations';
import type { SearchDismissalReason, SearchInvestigation, SiteInventoryPayload, SitePageObservation } from '@/lib/types';
import { cn } from '@/lib/utils';

const QUEUES: { id: OpportunityQueue; label: string }[] = [
    { id: 'active', label: 'Active' },
    { id: 'completed', label: 'Completed' },
    { id: 'dismissed', label: 'Dismissed' },
];

export interface OpportunityBacklogViewRow {
    item: ScoredOpportunity;
    decision?: SearchInvestigation;
    decisionKey: string | null;
    busy: boolean;
    error?: string;
}

function crawlPage(page: SitePageObservation): OpportunityCrawlPage {
    return {
        url: page.normalizedUrl,
        isHomepage: page.isHomepage,
        discoverySources: page.discoverySources,
        fetchStatus: page.fetchStatus,
        ...(page.statusCode != null ? { statusCode: page.statusCode } : {}),
        ...(page.contentType ? { contentType: page.contentType } : {}),
        ...(page.robotsAllowed != null ? { robotsAllowed: page.robotsAllowed } : {}),
        robotsDirectives: page.robotsDirectives,
        ...(page.title ? { title: page.title } : {}),
        ...(page.metaDescription ? { metaDescription: page.metaDescription } : {}),
        h1s: page.h1s,
        ...(page.wordCount != null ? { wordCount: page.wordCount } : {}),
        inboundInternalLinks: page.inboundInternalLinks,
    };
}

function curveRows(rows: HistoryRow[]) {
    return rows.map(row => ({
        dayId: row.dayId,
        position: row.position,
        clicks: row.clicks,
        impressions: row.impressions,
    }));
}

function aborted(reason: unknown): boolean {
    return reason instanceof Error && reason.name === 'AbortError';
}

function failureMessage(reason: unknown, fallback: string): string {
    return reason instanceof Error && reason.message ? reason.message : fallback;
}

async function loadCrawlPages(clientId: string, signal: AbortSignal): Promise<OpportunityCrawlPage[]> {
    const response = await fetch(`/api/site-inventory?clientId=${encodeURIComponent(clientId)}`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Site inventory could not be loaded.');
    const payload = await response.json() as SiteInventoryPayload;
    return (payload.pages ?? []).map(crawlPage);
}

async function loadCannibalization(organizationId: string, clientId: string): Promise<CannibalizationReport | null> {
    if (!keywordTrackingEnabled()) return null;
    const period = await loadRankingWindows({ organizationId, clientId });
    if (!period.enabled || !period.ok || !period.connected) return null;
    const snapshot = await loadRankings({ organizationId, clientId });
    if (snapshot.error || snapshot.keywords.length === 0) return null;
    const gsc = await loadTrackedKeywordGsc({
        organizationId,
        clientId,
        keywords: snapshot.keywords.map(keyword => ({ id: keyword.id, keyword: keyword.keyword })),
        current: period.current,
        compare: period.compare,
    });
    if (!gsc.enabled || !gsc.ok) return null;
    return gsc.cannibalization;
}

export function investigationKey(item: ScoredOpportunity): string | null {
    if (!item.investigation) return null;
    try {
        const kind = kindForEvidenceCategory(item.investigation.category);
        if (kind === 'overlap') {
            if (!item.query) return null;
            return investigationLookupKey({ kind, query: item.query });
        }
        if (kind === 'query_page') {
            if (!item.query || !item.page) return null;
            return investigationLookupKey({ kind, query: item.query, page: item.page });
        }
        if (!item.page) return null;
        return investigationLookupKey({ kind, page: item.page });
    } catch {
        return null;
    }
}

export function OpportunityBacklogTable({
    queue,
    counts,
    rows,
    notes,
    loading,
    error,
    workflowDisabled,
    windowLabel,
    onQueue,
    onReload,
    onCreateTask,
    onDismiss,
    onRestore,
    organizationId,
    clientId,
}: {
    queue: OpportunityQueue;
    counts: Record<OpportunityQueue, number>;
    rows: OpportunityBacklogViewRow[];
    notes: string[];
    loading: boolean;
    error: string;
    workflowDisabled: boolean;
    windowLabel: string;
    onQueue: (queue: OpportunityQueue) => void;
    onReload: () => void;
    onCreateTask: (row: OpportunityBacklogViewRow) => void;
    onDismiss: (row: OpportunityBacklogViewRow, reason: SearchDismissalReason, note?: string) => void;
    onRestore: (row: OpportunityBacklogViewRow) => void;
    organizationId: string;
    clientId: string;
}) {
    return (
        <div className="space-y-3" data-opportunity-backlog="table">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="group" aria-label="Backlog status" className="flex rounded-lg border border-border p-0.5">
                    {QUEUES.map(item => {
                        const active = queue === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                aria-pressed={active}
                                onClick={() => onQueue(item.id)}
                                className={cn(
                                    'rounded-md px-2.5 py-1 text-xs font-medium tabular-nums',
                                    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {item.label} {counts[item.id]}
                            </button>
                        );
                    })}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {windowLabel ? <span>{windowLabel}</span> : null}
                    <button type="button" onClick={onReload} className="text-primary underline">Reload</button>
                </div>
            </div>
            <p className="text-xs text-muted-foreground">
                Est. clicks uses this client's CTR by rounded position and needs at least 7 observed days. Otherwise it stays —. A score is omitted when the evidence for that action is incomplete. The score orders the backlog. It is not a predicted ranking gain.
            </p>
            {notes.map(note => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            {loading ? <p role="status" className="text-sm text-muted-foreground">Loading saved opportunities…</p> : null}
            {!loading && rows.length === 0 ? (
                <p className="rounded-lg border border-border bg-card px-3 py-6 text-sm text-muted-foreground">
                    {queue === 'active'
                        ? 'No scored opportunities in this window.'
                        : queue === 'completed'
                            ? 'No scored rows have a completed investigation.'
                            : 'No scored rows have a dismissed investigation.'}
                </p>
            ) : null}
            {!loading && rows.length > 0 ? (
                <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-card">
                    <table className="w-full min-w-[920px] border-collapse text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
                            <tr>
                                {['Score', 'Action', 'Page/Query', 'Impact', 'Effort', 'Est. clicks', 'Evidence', 'Decision'].map(label => (
                                    <th key={label} scope="col" className="px-2 py-1.5 font-medium">{label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => {
                                const primary = row.item.query ?? row.item.page;
                                return (
                                    <tr key={row.item.id} className="border-t border-border/70 align-top hover:bg-muted/30">
                                        <td className="px-2 py-1.5">
                                            <span className="inline-flex min-w-8 justify-center rounded bg-primary/10 px-1.5 py-0.5 font-semibold tabular-nums text-primary">{row.item.score}</span>
                                        </td>
                                        <td className="px-2 py-1.5 font-medium">{row.item.actionLabel}</td>
                                        <td className="max-w-[240px] px-2 py-1.5">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="min-w-0 truncate font-medium" title={primary ?? ''}>{formatOpportunityText(primary)}</p>
                                                {row.item.query ? <TrackQueryButton organizationId={organizationId} clientId={clientId} query={row.item.query} /> : null}
                                            </div>
                                            {row.item.query ? <p className="truncate text-muted-foreground" title={row.item.page ?? ''}>{formatOpportunityText(row.item.page)}</p> : null}
                                        </td>
                                        <td className="px-2 py-1.5">{formatOpportunityLabel(row.item.impact)}</td>
                                        <td className="px-2 py-1.5">{formatOpportunityLabel(row.item.effort)}</td>
                                        <td className="px-2 py-1.5 tabular-nums" data-est-clicks={formatOpportunityNumber(row.item.estClicks)}>{formatOpportunityNumber(row.item.estClicks)}</td>
                                        <td className="max-w-md px-2 py-1.5 text-muted-foreground">{row.item.evidence}</td>
                                        <td className="px-2 py-1.5">
                                            {row.item.investigation && row.decisionKey ? (
                                                <SearchInvestigationActions
                                                    decision={row.decision}
                                                    busy={row.busy}
                                                    disabled={workflowDisabled}
                                                    error={row.error}
                                                    onCreateTask={() => onCreateTask(row)}
                                                    onDismiss={(reason, note) => onDismiss(row, reason, note)}
                                                    onRestore={() => onRestore(row)}
                                                />
                                            ) : <span className="text-muted-foreground">—</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </div>
    );
}

export function OpportunityBacklog({
    organizationId,
    clientId,
    clientName,
    onConnections,
}: {
    organizationId: string;
    clientId: string;
    clientName: string;
    onConnections: () => void;
}) {
    const [queue, setQueue] = useState<OpportunityQueue>('active');
    const [revision, setRevision] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notes, setNotes] = useState<string[]>([]);
    const [items, setItems] = useState<ScoredOpportunity[]>([]);
    const [investigations, setInvestigations] = useState<SearchInvestigation[]>([]);
    const [property, setProperty] = useState('');
    const [rangeLabel, setRangeLabel] = useState('');
    const [windowRange, setWindowRange] = useState<{ start: string; end: string } | null>(null);
    const [workflowLoading, setWorkflowLoading] = useState(true);
    const [workflowError, setWorkflowError] = useState('');
    const [pending, setPending] = useState<Set<string>>(new Set());
    const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
    const [taskTarget, setTaskTarget] = useState<SearchInvestigation>();

    useEffect(() => {
        const controller = new AbortController();
        const range = insightsRange(28);
        setLoading(true);
        setError('');
        setNotes([]);
        setWorkflowLoading(true);
        setWorkflowError('');
        setItemErrors({});
        setTaskTarget(undefined);

        const insightsPromise = loadSearchInsights(clientId, range, controller.signal);
        const historyPromise = loadHistory(clientId, range, 'query_page', controller.signal);
        const crawlPromise = loadCrawlPages(clientId, controller.signal);
        const investigationPromise = getSearchInvestigations(clientId);
        const cannibalPromise = loadCannibalization(organizationId, clientId);

        void (async () => {
            const [insightsResult, historyResult, crawlResult, investigationResult, cannibalResult] = await Promise.allSettled([
                insightsPromise,
                historyPromise,
                crawlPromise,
                investigationPromise,
                cannibalPromise,
            ]);
            if (controller.signal.aborted) return;

            const nextNotes: string[] = [];
            let nextError = '';
            const scoredInput: ScoreOpportunitiesInput = {
                days: [],
                missingDates: [],
                expandedEvidenceAvailable: false,
                queryPageRollups: [],
                pageRollups: [],
                visibilityRollups: [],
                overlapRollups: [],
                gscRows: [],
                gscRowsTruncated: true,
                brand: clientName,
                pages: [],
                cannibalization: null,
            };

            if (insightsResult.status === 'fulfilled') {
                const insights = insightsResult.value;
                scoredInput.days = insights.days;
                scoredInput.missingDates = insights.missingDates;
                scoredInput.expandedEvidenceAvailable = insights.expandedEvidenceAvailable;
                scoredInput.queryPageRollups = insights.queryPageRollups;
                scoredInput.pageRollups = insights.pageRollups;
                scoredInput.visibilityRollups = insights.visibilityRollups;
                scoredInput.overlapRollups = insights.overlapRollups;
                scoredInput.gscRowsTruncated = false;
                setProperty(insights.property);
                setWindowRange({ start: insights.start, end: insights.end });
                setRangeLabel(`28 days · ${insights.start} – ${insights.end}`);
            } else if (!aborted(insightsResult.reason)) {
                nextError = failureMessage(insightsResult.reason, 'Search evidence could not be loaded.');
                setProperty('');
                setWindowRange(null);
                setRangeLabel('');
                nextNotes.push('Ranking, demand, and Search Console overlap are hidden until search evidence loads.');
            }

            if (historyResult.status === 'fulfilled' && insightsResult.status === 'fulfilled') {
                const history = historyResult.value;
                const insights = insightsResult.value;
                const mismatch = history.property !== insights.property || JSON.stringify(history.days) !== JSON.stringify(insights.days);
                if (history.truncated || mismatch) {
                    scoredInput.gscRowsTruncated = true;
                    nextNotes.push('Est. clicks is hidden because saved query history is incomplete.');
                } else {
                    scoredInput.gscRows = curveRows(history.rows);
                    scoredInput.gscRowsTruncated = false;
                }
            } else if (historyResult.status === 'rejected' && !aborted(historyResult.reason)) {
                scoredInput.gscRowsTruncated = true;
                nextNotes.push('Est. clicks is hidden because saved query rows could not be loaded.');
            }

            if (crawlResult.status === 'fulfilled') {
                scoredInput.pages = crawlResult.value;
            } else if (!aborted(crawlResult.reason)) {
                nextNotes.push('Crawl findings are hidden because the site inventory could not be loaded.');
            }

            if (investigationResult.status === 'fulfilled') {
                if (investigationResult.value.success) {
                    setInvestigations(investigationResult.value.data);
                    setWorkflowError('');
                } else {
                    setInvestigations([]);
                    setWorkflowError(investigationResult.value.error);
                }
            } else if (!aborted(investigationResult.reason)) {
                setInvestigations([]);
                setWorkflowError('Investigation decisions could not be loaded.');
            }
            setWorkflowLoading(false);

            if (cannibalResult.status === 'fulfilled') {
                scoredInput.cannibalization = cannibalResult.value;
            } else if (!aborted(cannibalResult.reason)) {
                nextNotes.push('Tracked-keyword overlap could not be loaded.');
            }

            if (!controller.signal.aborted) {
                setItems(scoreOpportunities(scoredInput));
                setNotes(nextNotes);
                setError(nextError);
                setLoading(false);
            }
        })();

        return () => controller.abort();
    }, [clientId, clientName, organizationId, revision]);

    const decisions = useMemo(
        () => mapInvestigationsByIdentity(investigations, property),
        [investigations, property],
    );

    const viewRows = useMemo(() => items.map(item => {
        const decisionKey = investigationKey(item);
        const decision = decisionKey ? decisions.get(decisionKey) : undefined;
        return {
            item,
            decision,
            decisionKey,
            busy: decisionKey ? pending.has(decisionKey) : false,
            error: decisionKey ? itemErrors[decisionKey] || undefined : undefined,
        };
    }), [decisions, itemErrors, items, pending]);

    const counts = useMemo(() => {
        const tally: Record<OpportunityQueue, number> = { active: 0, completed: 0, dismissed: 0 };
        for (const row of viewRows) tally[opportunityQueue(row.decision?.status)] += 1;
        return tally;
    }, [viewRows]);

    const visibleRows = viewRows.filter(row => opportunityQueue(row.decision?.status) === queue);

    const replaceDecision = (decision: SearchInvestigation) => {
        setInvestigations(current => [decision, ...current.filter(item => item.id !== decision.id)]);
    };

    const saveDecision = async (
        row: OpportunityBacklogViewRow,
        status: 'open' | 'dismissed',
        dismissalReason?: SearchDismissalReason,
        dismissalNote?: string,
    ) => {
        if (!row.item.investigation || !row.decisionKey || !property || !windowRange || workflowLoading || workflowError) return undefined;
        const key = row.decisionKey;
        const kind = kindForEvidenceCategory(row.item.investigation.category);
        setPending(current => new Set(current).add(key));
        setItemErrors(current => ({ ...current, [key]: '' }));
        try {
            const result = await setSearchInvestigationDecision({
                clientId,
                property,
                kind,
                query: kind === 'page' ? null : row.item.query,
                page: kind === 'overlap' ? null : row.item.page,
                status,
                dismissalReason: dismissalReason ?? null,
                dismissalNote: dismissalNote?.trim() || null,
                evidenceSnapshot: buildInvestigationSnapshot({
                    category: row.item.investigation.category,
                    property,
                    start: windowRange.start,
                    end: windowRange.end,
                    evidence: row.item.investigation.evidence,
                }),
            });
            if (!result.success || !result.data) {
                setItemErrors(current => ({ ...current, [key]: result.error ?? 'Unable to save this investigation decision.' }));
                return undefined;
            }
            replaceDecision(result.data);
            return result.data;
        } catch {
            setItemErrors(current => ({ ...current, [key]: 'Unable to save this investigation decision.' }));
            return undefined;
        } finally {
            setPending(current => {
                const next = new Set(current);
                next.delete(key);
                return next;
            });
        }
    };

    return (
        <section className="min-w-0" aria-label="Opportunity backlog">
            <OpportunityBacklogTable
                queue={queue}
                counts={counts}
                rows={visibleRows}
                notes={notes}
                loading={loading}
                error={error}
                workflowDisabled={workflowLoading || Boolean(workflowError)}
                windowLabel={rangeLabel}
                onQueue={setQueue}
                onReload={() => setRevision(value => value + 1)}
                onCreateTask={row => {
                    void (async () => {
                        const reserved = await saveDecision(row, 'open');
                        if (reserved?.status === 'open') setTaskTarget(reserved);
                    })();
                }}
                onDismiss={(row, reason, note) => { void saveDecision(row, 'dismissed', reason, note); }}
                onRestore={row => { void saveDecision(row, 'open'); }}
                organizationId={organizationId}
                clientId={clientId}
            />
            {error ? <button type="button" className="mt-3 text-sm text-primary underline" onClick={onConnections}>Manage Google Search Console connection</button> : null}
            {workflowError ? <p role="alert" className="mt-3 text-sm text-amber-600 dark:text-amber-400">{workflowError} Reload to retry.</p> : null}
            {taskTarget ? (
                <CreateTaskModal
                    isOpen
                    organizationId={organizationId}
                    defaultClientId={clientId}
                    defaultClientName={clientName}
                    {...investigationTaskHandoff(taskTarget, clientName)}
                    onClose={() => setTaskTarget(undefined)}
                    onCreated={() => {
                        void getSearchInvestigations(clientId).then(result => {
                            if (result.success) setInvestigations(result.data);
                        });
                    }}
                />
            ) : null}
        </section>
    );
}

