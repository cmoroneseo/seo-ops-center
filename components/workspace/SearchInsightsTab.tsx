'use client';

import React, { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { evidenceIsComplete, filterOverlapCandidates, filterPageCandidates, filterRankingCandidates, filterVisibilityCandidates, insightsRange, loadHistory, loadSearchInsights, safePageUrl, summarizePerformance, type Candidate, type OverlapCandidate, type PageCandidate } from '@/lib/gsc/insights';
import { historyDates } from '@/lib/gsc/history';
import { buildInvestigationSnapshot, investigationLookupKey, kindForEvidenceCategory, taskPrefillForInvestigation, type InvestigationIdentityInput } from '@/lib/gsc/investigations';
import { getSearchInvestigations, setSearchInvestigationDecision } from '@/lib/supabase/search-investigations';
import type { SearchDismissalReason, SearchEvidenceCategory, SearchInvestigation } from '@/lib/types';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { SearchInvestigationActions } from './SearchInvestigationActions';

type LoadedHistory = Awaited<ReturnType<typeof loadHistory>>;
type LoadedInsights = Awaited<ReturnType<typeof loadSearchInsights>>;
const number = new Intl.NumberFormat('en-US');
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(2)}%`;

type Evidence = Candidate | PageCandidate | OverlapCandidate;

function identityForEvidence(category: SearchEvidenceCategory, evidence: Evidence): InvestigationIdentityInput {
    const kind = kindForEvidenceCategory(category);
    if (kind === 'overlap') return { kind, query: (evidence as OverlapCandidate).query };
    if (kind === 'page') return { kind, page: (evidence as PageCandidate).page };
    const candidate = evidence as Candidate;
    return { kind, query: candidate.query, page: candidate.page };
}

export function investigationTaskHandoff(decision: SearchInvestigation, clientName: string) {
    const prefill = taskPrefillForInvestigation(decision.evidenceSnapshot, clientName);
    return {
        defaultTitle: prefill.title,
        defaultDescription: prefill.description,
        defaultCategory: prefill.category,
        defaultPriority: prefill.priority,
        defaultTags: prefill.tags,
        sourceInvestigationId: decision.id,
    };
}

export function mapInvestigationsByIdentity(investigations: SearchInvestigation[], property?: string) {
    const decisions = new Map<string, SearchInvestigation>();
    if (!property) return decisions;
    for (const decision of investigations) {
        if (decision.property !== property) continue;
        try {
            const key = investigationLookupKey({
                kind: decision.kind,
                ...(decision.query ? { query: decision.query } : {}),
                ...(decision.page ? { page: decision.page } : {}),
            } as InvestigationIdentityInput);
            decisions.set(key, decision);
        } catch {
            // A malformed historical row must not hide current GSC evidence.
        }
    }
    return decisions;
}

export function InvestigationEvidenceCard({
    summary,
    children,
    decision,
    busy,
    workflowDisabled,
    error,
    onCreateTask,
    onDismiss,
    onRestore,
}: {
    summary: ReactNode;
    children?: ReactNode;
    decision?: SearchInvestigation;
    busy: boolean;
    workflowDisabled: boolean;
    error?: string;
    onCreateTask: () => void;
    onDismiss: (reason: SearchDismissalReason, note?: string) => void;
    onRestore: () => void;
}) {
    return <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer">{summary}</summary>
        <div className="mt-4 space-y-3 border-t border-border pt-4 text-sm">
            {children}
            <div className="border-t border-border pt-3">
                <SearchInvestigationActions
                    decision={decision}
                    busy={busy}
                    disabled={workflowDisabled}
                    error={error}
                    onCreateTask={onCreateTask}
                    onDismiss={onDismiss}
                    onRestore={onRestore}
                />
            </div>
        </div>
    </details>;
}

export function SearchInsightsTab({ organizationId, clientId, clientName, onConnections, onSiteInventory }: { organizationId: string; clientId: string; clientName: string; onConnections: () => void; onSiteInventory?: () => void }) {
    const [period, setPeriod] = useState<7 | 28>(28);
    const [revision, setRevision] = useState(0);
    const [property, setProperty] = useState<LoadedHistory | null>(null);
    const [queries, setQueries] = useState<LoadedInsights | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [queryError, setQueryError] = useState('');
    const [filter, setFilter] = useState('');
    const [copied, setCopied] = useState('');
    const [copyError, setCopyError] = useState('');
    const [investigations, setInvestigations] = useState<SearchInvestigation[]>([]);
    const [workflowLoading, setWorkflowLoading] = useState(true);
    const [workflowError, setWorkflowError] = useState('');
    const [pendingIdentities, setPendingIdentities] = useState<Set<string>>(new Set());
    const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
    const [selectedTaskInvestigation, setSelectedTaskInvestigation] = useState<SearchInvestigation>();

    useEffect(() => {
        const controller = new AbortController();
        const range = insightsRange(period);
        setLoading(true); setProperty(null); setQueries(null); setError(''); setQueryError(''); setCopied('');
        setWorkflowLoading(true); setWorkflowError(''); setItemErrors({}); setSelectedTaskInvestigation(undefined);
        // Property totals stay useful even if query evidence cannot be loaded.
        Promise.all([
            loadHistory(clientId, range, 'property', controller.signal).then(data => { if (!controller.signal.aborted) setProperty(data); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }),
            loadSearchInsights(clientId, range, controller.signal).then(data => { if (!controller.signal.aborted) setQueries(data); }).catch(reason => { if (!controller.signal.aborted) setQueryError(reason.message); }),
        ]).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        // Workflow state starts in parallel and never delays the GSC evidence waterfall.
        getSearchInvestigations(clientId).then(result => {
            if (controller.signal.aborted) return;
            if (result.success) setInvestigations(result.data);
            else { setInvestigations([]); setWorkflowError(result.error); }
        }).finally(() => { if (!controller.signal.aborted) setWorkflowLoading(false); });
        return () => controller.abort();
    }, [clientId, period, revision]);

    const totals = useMemo(() => summarizePerformance(property?.rows ?? []), [property]);
    const snapshotsMatch = !!property && !!queries && property.property === queries.property && JSON.stringify(property.days) === JSON.stringify(queries.days);
    const queryComplete = snapshotsMatch && evidenceIsComplete(queries!.days, queries!.missingDates, 'query');
    const expandedQueryComplete = queryComplete && !!queries?.expandedEvidenceAvailable;
    const pageComplete = snapshotsMatch && !!queries?.expandedEvidenceAvailable && evidenceIsComplete(queries!.days, queries!.missingDates, 'page');
    const candidates = useMemo(() => queryComplete ? filterRankingCandidates(queries!.queryPageRollups, clientName) : [], [queryComplete, queries, clientName]);
    const pages = useMemo(() => pageComplete ? filterPageCandidates(queries!.pageRollups) : [], [pageComplete, queries]);
    const visibility = useMemo(() => expandedQueryComplete ? filterVisibilityCandidates(queries!.visibilityRollups, clientName) : [], [expandedQueryComplete, queries, clientName]);
    const overlaps = useMemo(() => expandedQueryComplete ? filterOverlapCandidates(queries!.overlapRollups, clientName) : [], [expandedQueryComplete, queries, clientName]);
    const normalizedFilter = filter.trim().toLowerCase();
    const filtered = candidates.filter(item => `${item.query} ${item.page}`.toLowerCase().includes(normalizedFilter));
    const filteredPages = pages.filter(item => item.page.toLowerCase().includes(normalizedFilter));
    const filteredVisibility = visibility.filter(item => `${item.query} ${item.page}`.toLowerCase().includes(normalizedFilter));
    const filteredOverlaps = overlaps.filter(item => `${item.query} ${item.pages.map(page => page.page).join(' ')}`.toLowerCase().includes(normalizedFilter));
    const chart = useMemo(() => {
        if (!property) return [];
        return historyDates(property.start, property.end).map(date => {
            const day = property.days.find(item => item.date === date);
            const rows = property.rows.filter(row => row.dayId === day?.id);
            return { date, clicks: day ? summarizePerformance(rows).clicks : null };
        });
    }, [property]);
    const lastImport = property?.days.map(day => day.importedAt).sort().at(-1);
    const decisionMap = useMemo(
        () => mapInvestigationsByIdentity(investigations, property?.property),
        [investigations, property?.property],
    );

    const replaceDecision = (decision: SearchInvestigation) => {
        setInvestigations(current => [decision, ...current.filter(item => item.id !== decision.id)]);
    };

    const refreshInvestigationDecisions = async () => {
        const result = await getSearchInvestigations(clientId);
        if (result.success) {
            setInvestigations(result.data);
            setWorkflowError('');
        } else {
            setWorkflowError(result.error);
        }
    };

    const workflowFor = (category: SearchEvidenceCategory, evidence: Evidence) => {
        const identity = identityForEvidence(category, evidence);
        const key = investigationLookupKey(identity);
        return { identity, key, decision: decisionMap.get(key) };
    };

    const saveDecision = async (
        category: SearchEvidenceCategory,
        evidence: Evidence,
        status: 'open' | 'dismissed',
        dismissalReason?: SearchDismissalReason,
        dismissalNote?: string,
    ) => {
        if (!property || workflowLoading || workflowError) return undefined;
        const { identity, key } = workflowFor(category, evidence);
        setPendingIdentities(current => new Set(current).add(key));
        setItemErrors(current => ({ ...current, [key]: '' }));
        try {
            const result = await setSearchInvestigationDecision({
                clientId,
                property: property.property,
                kind: identity.kind,
                query: 'query' in identity ? identity.query : null,
                page: 'page' in identity ? identity.page : null,
                status,
                dismissalReason: dismissalReason ?? null,
                dismissalNote: dismissalNote?.trim() || null,
                evidenceSnapshot: buildInvestigationSnapshot({
                    category,
                    property: property.property,
                    start: property.start,
                    end: property.end,
                    evidence,
                }),
            });
            if (!result.success || !result.data) {
                setItemErrors(current => ({ ...current, [key]: result.error ?? 'Unable to save this investigation decision.' }));
                return undefined;
            }
            replaceDecision(result.data);
            return result.data;
        } catch {
            console.error('Unable to prepare investigation evidence.');
            setItemErrors(current => ({ ...current, [key]: 'Unable to save this investigation decision.' }));
            return undefined;
        } finally {
            setPendingIdentities(current => {
                const next = new Set(current);
                next.delete(key);
                return next;
            });
        }
    };

    const workflowProps = (category: SearchEvidenceCategory, evidence: Evidence) => {
        const { key, decision } = workflowFor(category, evidence);
        return {
            decision,
            busy: pendingIdentities.has(key),
            workflowDisabled: workflowLoading || Boolean(workflowError),
            error: itemErrors[key] || undefined,
            onCreateTask: async () => {
                const reserved = await saveDecision(category, evidence, 'open');
                if (reserved?.status === 'open') setSelectedTaskInvestigation(reserved);
            },
            onDismiss: (reason: SearchDismissalReason, note?: string) => { void saveDecision(category, evidence, 'dismissed', reason, note); },
            onRestore: () => { void saveDecision(category, evidence, 'open'); },
        };
    };

    return <section className="space-y-6" aria-label="Search Insights">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-xs uppercase tracking-widest text-primary">Search performance</p><h2 className="mt-1 text-2xl font-semibold">Search Insights</h2><p className="mt-1 text-sm text-muted-foreground">Find work worth investigating for {clientName}.</p></div>
            <div className="flex flex-wrap items-center gap-2">
                {onSiteInventory && <button onClick={onSiteInventory} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><ShieldCheck className="h-4 w-4" />Site inventory</button>}
                <div className="flex rounded-lg border border-border p-1" aria-label="Reporting period">{([7, 28] as const).map(days => <button key={days} aria-pressed={period === days} onClick={() => setPeriod(days)} className={`rounded-md px-3 py-1.5 text-sm ${period === days ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{days} days</button>)}</div>
                <button onClick={() => setRevision(value => value + 1)} disabled={loading} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Reload saved data</button>
            </div>
        </div>
        {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-card p-5"><p>{error}</p><button className="mt-3 text-sm text-primary underline" onClick={onConnections}>Manage Google Search Console connection</button></div>}
        {loading && !property && !error && <p role="status" className="rounded-xl border border-border bg-card p-8 text-muted-foreground">Loading saved search performance…</p>}
        {property && <>
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-primary" />Selected Search Console property</p><p className="mt-2 break-all font-mono text-sm">{property.property}</p></div><button onClick={onConnections} className="text-sm text-primary underline">Manage connection</button></div>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"><span>{property.start} – {property.end} · Pacific dates</span><span>{property.days.length}/{period} days saved</span><span>{lastImport ? `Latest import ${new Date(lastImport).toLocaleString()}` : 'Waiting for the first import'}</span></div>
                <p className="mt-3 text-xs text-muted-foreground">Daily imports use finalized web-search data ending at least three days ago. Reload reads saved data.</p>
                {property.missingDates.length > 0 && <p role="status" className="mt-3 text-sm text-amber-600 dark:text-amber-400">{property.missingDates.length} days are missing. Totals cover saved days only; investigations are paused until coverage is complete.</p>}
                {workflowError && <p role="alert" className="mt-3 text-sm text-amber-600 dark:text-amber-400">Evidence is available, but investigation decisions could not be loaded. Reload saved data to retry.</p>}
            </div>
            {property.days.length > 0 ? <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
                    ['Clicks', number.format(totals.clicks), 'Visits from Google Search'],
                    ['Impressions', number.format(totals.impressions), 'Search result appearances'],
                    ['CTR', percent(totals.ctr), 'Clicks divided by impressions'],
                    ['Average position', totals.position?.toFixed(1) ?? '—', 'Weighted by impressions'],
                ].map(([label, value, hint]) => <div key={label} className="rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p><p className="mt-2 text-xs text-muted-foreground">{hint}</p></div>)}</div>
                <div className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">Daily clicks</h3><p className="mt-1 text-xs text-muted-foreground">Gaps indicate missing imports, not zero clicks.</p><div className="mt-4 h-56" role="img" aria-label={`Daily clicks from ${property.start} to ${property.end}. ${totals.clicks} total clicks across ${property.days.length} saved days. Daily values are available below.`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" opacity={0.15} /><XAxis dataKey="date" tickFormatter={value => value.slice(5)} stroke="var(--muted-foreground)" fontSize={11} minTickGap={35} /><YAxis allowDecimals={false} width={35} stroke="var(--muted-foreground)" fontSize={11} /><Tooltip /><Line type="linear" dataKey="clicks" stroke="var(--primary)" strokeWidth={2} dot={false} connectNulls={false} /></LineChart></ResponsiveContainer></div><details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">View daily values</summary><div className="mt-2 max-h-48 overflow-auto"><table className="w-full text-left"><thead><tr><th scope="col">Date</th><th scope="col">Clicks</th></tr></thead><tbody>{chart.map(row => <tr key={row.date}><td>{row.date}</td><td>{row.clicks ?? 'Missing'}</td></tr>)}</tbody></table></div></details></div>
            </> : <div className="rounded-xl border border-border bg-card p-8"><h3 className="font-medium">History is getting started</h3><p className="mt-2 text-sm text-muted-foreground">The daily import will collect history for this property. Performance and investigation evidence will appear as data arrives.</p></div>}
            {(queryComplete || pageComplete) && <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"><Search className="h-4 w-4 text-muted-foreground" /><span className="sr-only">Filter evidence by query or page</span><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter evidence by query or page" className="w-full bg-transparent text-sm outline-none" /></label>}
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">Near-page-one query investigations</h3><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Queries with at least 100 impressions across 3 saved days and average positions 4–20. Ordered by observed impressions.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{queryComplete ? `${candidates.length} ${candidates.length === 1 ? 'candidate' : 'candidates'}` : 'Awaiting evidence'}</span></div>
                <p className="mt-3 text-xs text-muted-foreground">Exact client-name brand matches and common utility pages are excluded. Brand variants may remain. These are research candidates; content gaps and ranking gains have not been established.</p>
                {queryError ? <p role="alert" className="mt-5 text-sm text-destructive">Query evidence unavailable: {queryError}</p> : loading ? <p role="status" className="mt-5 text-sm text-muted-foreground">Loading query evidence…</p> : !queryComplete ? <p className="mt-5 text-sm text-muted-foreground">Query investigations are paused because history is incomplete, capped, or changed during loading. Reload after the next import.</p> : candidates.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No queries meet these evidence thresholds yet. This does not mean the site has no SEO opportunities.</p> : <>
                    <div className="mt-4 space-y-3">{filtered.slice(0, 50).map(item => <InvestigationEvidenceCard
                        key={JSON.stringify([item.query, item.page])}
                        summary={<><span className="font-medium">{item.query}</span><span className="mt-2 block break-all text-xs text-muted-foreground">{item.page}</span><span className="mt-2 block text-sm text-muted-foreground">{number.format(item.impressions)} impressions · Position {item.position.toFixed(1)} · {item.clicks} clicks · {percent(item.ctr)} CTR</span></>}
                        {...workflowProps('near_page_one', item)}
                    >
                        <p><strong>What we observed:</strong> This query appeared for this URL on {item.observedDays} saved days in the selected period.</p>
                        <p><strong>Next action:</strong> Inspect the current search results and landing page. Confirm the intended destination, search intent, and business value before deciding whether to improve this page.</p>
                        <p><strong>Evidence still needed:</strong> Current page content, competing results, and any other client pages targeting the same intent.</p>
                        <p><strong>Done when:</strong> The intended landing page and a specific change are documented with evidence, or the candidate is rejected with a reason.</p>
                        <div className="flex flex-wrap gap-4"><a href={safePageUrl(item.page)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">Inspect page<ArrowUpRight className="h-4 w-4" /></a><button className="text-primary underline" onClick={async () => { try { await navigator.clipboard.writeText(`Investigate search evidence: ${item.query}\nClient: ${clientName}\nProperty: ${property.property}\nPage: ${item.page}\nPeriod: ${property.start} to ${property.end}\nEvidence: ${item.impressions} impressions, ${item.clicks} clicks, average position ${item.position.toFixed(1)}, ${item.observedDays} observed days.\nReview current SERP, page content, intended destination, business value and overlapping pages. Document a specific evidence-backed change or reason to reject. No ranking gain is predicted.`); setCopied(JSON.stringify([item.query, item.page])); setCopyError(''); } catch { setCopyError('Clipboard unavailable. Select and copy the evidence above.'); } }}>{copied === JSON.stringify([item.query, item.page]) ? 'Brief copied' : 'Copy investigation brief'}</button></div>
                    </InvestigationEvidenceCard>)}</div>
                    {!filtered.length && <p className="mt-4 text-sm text-muted-foreground">No candidates match your filter.</p>}
                    {filtered.length > 50 && <p className="mt-4 text-xs text-muted-foreground">Showing the first 50 of {filtered.length}. Refine your filter to find more.</p>}
                </>}
                {copyError && <p role="alert" className="mt-3 text-sm text-destructive">{copyError}</p>}
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">Page-level visibility investigations</h3><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Existing URLs with at least 250 impressions across 3 saved days and weighted average positions 4–50.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{pageComplete ? `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}` : 'Awaiting evidence'}</span></div>
                <p className="mt-3 text-xs text-muted-foreground">Page totals do not reveal whether impressions are branded, relevant, or underperforming. Inspect query mix and page purpose before proposing work.</p>
                {queryError ? <p role="alert" className="mt-5 text-sm text-destructive">Page evidence unavailable: {queryError}</p> : loading ? <p role="status" className="mt-5 text-sm text-muted-foreground">Loading page evidence…</p> : !queries?.expandedEvidenceAvailable ? <p className="mt-5 text-sm text-muted-foreground">Expanded page evidence is awaiting the database rollout. Existing query evidence remains available.</p> : !pageComplete ? <p className="mt-5 text-sm text-muted-foreground">Page investigations are paused because page history is incomplete, capped, or changed during loading.</p> : pages.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No pages meet these evidence thresholds in this period.</p> : <div className="mt-4 space-y-3">{filteredPages.slice(0, 50).map(item => <InvestigationEvidenceCard
                    key={item.page}
                    summary={<><span className="break-all font-medium">{item.page}</span><span className="mt-2 block text-sm text-muted-foreground">{number.format(item.impressions)} impressions · Position {item.position.toFixed(1)} · {item.clicks} clicks · {percent(item.ctr)} CTR</span></>}
                    {...workflowProps('page_visibility', item)}
                >
                    <p><strong>What we observed:</strong> This URL appeared in page-level Search Console data on {item.observedDays} saved days.</p>
                    <p><strong>Next action:</strong> Review its query mix, business purpose, current content, and search results before deciding whether any change is warranted.</p>
                    <p><strong>Evidence still needed:</strong> Branded versus nonbranded demand, relevant queries, intended conversions, page content, and competing results.</p>
                    <p><strong>Done when:</strong> The page is documented as needing a specific evidence-backed change, needing further research, or requiring no action.</p>
                    <a href={safePageUrl(item.page)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">Inspect page<ArrowUpRight className="h-4 w-4" /></a>
                </InvestigationEvidenceCard>)}</div>}
                {pageComplete && pages.length > 0 && filteredPages.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No page evidence matches your filter.</p>}
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">Queries with deeper visibility</h3><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Queries with at least 100 impressions across 3 saved days and weighted average positions above 20 through 50.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{expandedQueryComplete ? `${visibility.length} ${visibility.length === 1 ? 'query' : 'queries'}` : 'Awaiting evidence'}</span></div>
                <p className="mt-3 text-xs text-muted-foreground">Visibility beyond position 20 is observed evidence, not proof that the URL should rank higher or that optimization will produce a gain.</p>
                {queryError ? <p role="alert" className="mt-5 text-sm text-destructive">Query evidence unavailable: {queryError}</p> : loading ? <p role="status" className="mt-5 text-sm text-muted-foreground">Loading query evidence…</p> : !queries?.expandedEvidenceAvailable ? <p className="mt-5 text-sm text-muted-foreground">Expanded query evidence is awaiting the database rollout. Existing near-page-one evidence remains available.</p> : !queryComplete ? <p className="mt-5 text-sm text-muted-foreground">Deeper-visibility investigations are paused because query history is incomplete, capped, or changed during loading.</p> : visibility.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No queries meet these deeper-visibility thresholds in this period.</p> : <div className="mt-4 space-y-3">{filteredVisibility.slice(0, 50).map(item => <InvestigationEvidenceCard
                    key={JSON.stringify([item.query, item.page])}
                    summary={<><span className="font-medium">{item.query}</span><span className="mt-2 block break-all text-xs text-muted-foreground">{item.page}</span><span className="mt-2 block text-sm text-muted-foreground">{number.format(item.impressions)} impressions · Position {item.position.toFixed(1)} · {item.clicks} clicks · {percent(item.ctr)} CTR</span></>}
                    {...workflowProps('deeper_visibility', item)}
                >
                    <p><strong>What we observed:</strong> This query and URL pair appeared on {item.observedDays} saved days. Its impression-weighted average position across the period was {item.position.toFixed(1)}.</p>
                    <p><strong>Next action:</strong> Confirm intent, business value, the intended destination, and realistic competition before choosing whether to investigate further.</p>
                    <p><strong>Evidence still needed:</strong> Current SERP, page relevance and quality, competing client URLs, and conversion value.</p>
                    <p><strong>Done when:</strong> A supported next step or a documented no-action decision is recorded.</p>
                    <a href={safePageUrl(item.page)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">Inspect page<ArrowUpRight className="h-4 w-4" /></a>
                </InvestigationEvidenceCard>)}</div>}
                {expandedQueryComplete && visibility.length > 0 && filteredVisibility.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No deeper-visibility evidence matches your filter.</p>}
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">Overlapping URL investigations</h3><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Queries observed for at least 2 URLs, with each URL reaching 10 impressions across 2 days and at least 100 combined impressions.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{expandedQueryComplete ? `${overlaps.length} ${overlaps.length === 1 ? 'query' : 'queries'}` : 'Awaiting evidence'}</span></div>
                <p className="mt-3 text-xs text-muted-foreground">Multiple URLs do not by themselves prove cannibalization. The URLs may serve different intents or reflect normal result changes.</p>
                {queryError ? <p role="alert" className="mt-5 text-sm text-destructive">Overlap evidence unavailable: {queryError}</p> : loading ? <p role="status" className="mt-5 text-sm text-muted-foreground">Loading overlap evidence…</p> : !queries?.expandedEvidenceAvailable ? <p className="mt-5 text-sm text-muted-foreground">Expanded overlap evidence is awaiting the database rollout. Existing near-page-one evidence remains available.</p> : !queryComplete ? <p className="mt-5 text-sm text-muted-foreground">Overlap investigations are paused because query history is incomplete, capped, or changed during loading.</p> : overlaps.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No queries meet these overlapping-URL thresholds in this period.</p> : <div className="mt-4 space-y-3">{filteredOverlaps.slice(0, 50).map(item => <InvestigationEvidenceCard
                    key={item.query}
                    summary={<><span className="font-medium">{item.query}</span><span className="mt-2 block text-sm text-muted-foreground">{item.pages.length} URLs · {number.format(item.impressions)} combined impressions · Position {item.position.toFixed(1)}</span></>}
                    {...workflowProps('overlapping_urls', item)}
                >
                    <p><strong>What we observed:</strong> Search Console associated this query with multiple retained URLs during the selected period.</p>
                    <ul className="space-y-2">{item.pages.map(page => <li key={page.page} className="rounded-md bg-muted/40 p-3"><a href={safePageUrl(page.page)} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">{page.page}</a><span className="mt-1 block text-xs text-muted-foreground">{number.format(page.impressions)} impressions · Position {page.position.toFixed(1)} · {page.observedDays} observed days</span></li>)}</ul>
                    <p><strong>Next action:</strong> Compare page purpose, intent, content, canonical signals, and the current SERP before deciding whether destinations overlap.</p>
                    <p><strong>Evidence still needed:</strong> Current rankings by location/device, page content, canonicals, internal links, and intended destination.</p>
                    <p><strong>Done when:</strong> The URLs are documented as distinct, consolidated, redirected, internally clarified, or left unchanged with evidence.</p>
                </InvestigationEvidenceCard>)}</div>}
                {expandedQueryComplete && overlaps.length > 0 && filteredOverlaps.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No overlap evidence matches your filter.</p>}
                <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">Google omits some queries. Query/page counts do not equal property totals. This view does not yet include crawl findings or AI-generated recommendations.</p>
            </div>
        </>}
        {selectedTaskInvestigation && <CreateTaskModal
            isOpen
            organizationId={organizationId}
            defaultClientId={clientId}
            defaultClientName={clientName}
            {...investigationTaskHandoff(selectedTaskInvestigation, clientName)}
            onClose={() => setSelectedTaskInvestigation(undefined)}
            onCreated={() => { void refreshInvestigationDecisions(); }}
        />}
    </section>;
}
