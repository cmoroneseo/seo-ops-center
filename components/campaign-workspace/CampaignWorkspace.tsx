'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ContentPlanSection } from '@/components/campaign-workspace/ContentPlanTable';
import { OverviewBriefing } from '@/components/campaign-workspace/OverviewBriefing';
import { RoadmapPanel } from '@/components/campaign-workspace/RoadmapPanel';
import {
    EMPTY_ENGAGEMENT,
    scopeBrief,
    type EngagementFacts,
} from '@/lib/campaign-workspace/briefing';
import { campaignWorkspaceEnabled } from '@/lib/campaign-workspace/flag';
import { loadScopeEvidence, type ScopeEvidence } from '@/lib/campaign-workspace/scope-load';
import {
    completedDeliveries,
    type CampaignInitiative,
} from '@/lib/campaign-workspace/initiatives';
import { loadCampaignMeasurement } from '@/lib/campaign-workspace/load';
import { campaignPageResults, type CampaignPageResult } from '@/lib/campaign-workspace/pages';
import {
    campaignIdentity,
    EMPTY_CAMPAIGN_MEASUREMENT,
    type CampaignIdentity,
    type CampaignMeasurement,
    type CampaignSitewide,
} from '@/lib/campaign-workspace/sources';
import { type ContentPlanRow } from '@/lib/campaign-workspace/content-plan';
import { type CampaignView } from '@/lib/campaign-workspace/view';
import { ptToday } from '@/lib/sync/months';
import { listCampaignInitiatives } from '@/lib/supabase/campaign-initiatives';
import { cn } from '@/lib/utils';

/**
 * Light canvas inside the dark app shell. Neutrals are literal so the dark
 * theme's white foreground cannot land on this surface. Pink stays the
 * existing primary token, used only for the selected local tab and segment.
 */
export const campaignWorkspaceFrameClass =
    '-mx-4 -mt-[calc(3.5rem+1rem)] -mb-20 min-h-[calc(100%+3.5rem+1rem+5rem)] bg-[#f4f4f6] px-4 pb-10 pt-[calc(3.5rem+1.25rem)] text-[#18181b] [color-scheme:light] sm:-mx-6 lg:-mx-8 lg:-my-8 lg:min-h-[calc(100%+4rem)] lg:px-8 lg:py-6';

const VIEWS: { id: CampaignView; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'roadmap', label: 'Roadmap' },
    { id: 'work', label: 'Work' },
    { id: 'results', label: 'Results' },
];

type InitiativePanelState =
    | { kind: 'ready'; initiatives: readonly CampaignInitiative[] }
    | { kind: 'loading' }
    | { kind: 'unavailable' };

const SUBTITLE: Record<CampaignView, string> = {
    overview: 'Roadmap, verified work, scope for this period, and measured results.',
    roadmap: 'Initiatives connect purpose, delivery, and evidence.',
    work: "This month's execution, not the client-facing roadmap.",
    results: 'Measured outcomes stay separate from completed delivery.',
};

type ScopeState =
    | { kind: 'loading' }
    | { kind: 'ready'; evidence: ScopeEvidence };

export function CampaignWorkspace({
    clientName,
    view,
    onView,
    organizationId,
    clientId,
    identity,
    snapshot,
    initiatives,
    engagement,
    scope,
    today: todayProp,
    monthlyBoard,
    contentPlanMonth,
    contentPlan,
}: {
    clientName: string;
    view: CampaignView;
    onView: (view: CampaignView) => void;
    organizationId?: string;
    clientId?: string;
    identity?: CampaignIdentity;
    /** Set in tests. When present, the view does not read live sources. */
    snapshot?: CampaignMeasurement;
    /** Set in tests. When present, the view does not read initiatives. */
    initiatives?: readonly CampaignInitiative[];
    /** Contract facts for the scope strip. Logged hours are loaded separately. */
    engagement?: EngagementFacts;
    /**
     * Set in tests. When present, the view does not read hours or fulfillment.
     * Logged hours here are the budget total. Stored config hours are not a field.
     */
    scope?: ScopeEvidence;
    /** ISO day used for milestones, bars, and evidence freshness. */
    today?: string;
    /**
     * The live monthly SEO Plan board. Mounted only on Work, under the content plan.
     * Roadmap stays initiatives; this board is execution.
     */
    monthlyBoard?: ReactNode;
    /** Set in tests. When present, Work does not read the content plan URL month. */
    contentPlanMonth?: string;
    /** Set in tests. When present, Work does not read stored content plan rows. */
    contentPlan?: readonly ContentPlanRow[];
}) {
    const [loaded, setLoaded] = useState<CampaignMeasurement | null>(null);
    const [remoteInitiatives, setRemoteInitiatives] = useState<CampaignInitiative[] | null>(null);
    const [initiativeNote, setInitiativeNote] = useState<string | null>(null);
    const [selectedInitiativeId, setSelectedInitiativeId] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [remoteScope, setRemoteScope] = useState<ScopeState | null>(null);
    const today = todayProp ?? ptToday(new Date());
    const engagementKey = JSON.stringify(engagement ?? null);
    const engagementRef = useRef(engagement);
    engagementRef.current = engagement;
    useEffect(() => {
        if (snapshot || !organizationId || !clientId) return;
        const controller = new AbortController();
        let active = true;
        setLoaded(null);
        loadCampaignMeasurement({
            organizationId,
            clientId,
            signal: controller.signal,
        }).then(result => {
            if (active) setLoaded(result);
        }).catch(error => {
            if (!active || controller.signal.aborted) return;
            if (error instanceof DOMException && error.name === 'AbortError') return;
            if (active) setLoaded(EMPTY_CAMPAIGN_MEASUREMENT);
        });
        return () => {
            active = false;
            controller.abort();
        };
    }, [snapshot, organizationId, clientId]);

    useEffect(() => {
        if (initiatives !== undefined || !clientId) return;
        let active = true;
        setRemoteInitiatives(null);
        setInitiativeNote(null);
        listCampaignInitiatives(clientId).then(result => {
            if (!active) return;
            setRemoteInitiatives(result.initiatives);
            setInitiativeNote(result.unavailable ? 'Initiatives are not available.' : null);
        }).catch(() => {
            if (!active) return;
            setRemoteInitiatives([]);
            setInitiativeNote('Initiatives are not available.');
        });
        return () => {
            active = false;
        };
    }, [initiatives, clientId, reloadToken]);

    useEffect(() => {
        if (scope !== undefined || !organizationId || !clientId) return;
        let active = true;
        setRemoteScope({ kind: 'loading' });
        const facts = engagementRef.current ?? EMPTY_ENGAGEMENT;
        loadScopeEvidence({
            organizationId,
            clientId,
            engagement: facts,
            month: today.slice(0, 7),
        }).then(evidence => {
            if (active) setRemoteScope({ kind: 'ready', evidence });
        }).catch(() => {
            if (!active) return;
            setRemoteScope({
                kind: 'ready',
                evidence: { month: today.slice(0, 7), loggedHours: null, cells: null },
            });
        });
        return () => {
            active = false;
        };
    }, [scope, organizationId, clientId, engagementKey, today]);

    if (!campaignWorkspaceEnabled()) return null;
    const name = clientName.trim() || 'This client';
    const measurement = snapshot ?? loaded ?? EMPTY_CAMPAIGN_MEASUREMENT;
    const profile = identity ?? campaignIdentity({});
    const work: InitiativePanelState = initiatives !== undefined
        ? { kind: 'ready', initiatives }
        : !clientId
            ? { kind: 'ready', initiatives: [] }
            : remoteInitiatives === null
                ? { kind: 'loading' }
                : initiativeNote
                    ? { kind: 'unavailable' }
                    : { kind: 'ready', initiatives: remoteInitiatives };
    const workMessage = work.kind === 'loading'
        ? 'Loading initiatives…'
        : work.kind === 'unavailable'
            ? 'Initiatives are not available.'
            : null;
    const readyInitiatives = work.kind === 'ready' ? work.initiatives : [];
    const facts = engagement ?? EMPTY_ENGAGEMENT;
    const willLoadScope = scope === undefined && Boolean(organizationId && clientId);
    const evidence = scope !== undefined
        ? scope
        : remoteScope?.kind === 'ready'
            ? remoteScope.evidence
            : null;
    const scopeModel = evidence
        ? scopeBrief({
            engagement: facts,
            month: evidence.month,
            loggedHours: evidence.loggedHours,
            cells: evidence.cells,
        })
        : willLoadScope || remoteScope?.kind === 'loading'
            ? null
            : scopeBrief({
                engagement: facts,
                month: today.slice(0, 7),
                loggedHours: null,
                cells: null,
            });

    return (
        <div className={campaignWorkspaceFrameClass}>
            <nav aria-label="Breadcrumb" className="text-[13px] text-[#71717a]">
                <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <li>
                        <Link href="/workspace" className="rounded-sm hover:text-[#18181b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18181b]">
                            Clients
                        </Link>
                    </li>
                    <li aria-hidden="true">/</li>
                    <li className="max-w-[24rem] truncate text-[#52525b]">{name}</li>
                    <li aria-hidden="true">/</li>
                    <li className="text-[#18181b]">Campaign</li>
                </ol>
            </nav>

            <header className="mt-4">
                <h1 className="text-[22px] font-bold leading-tight tracking-tight">Campaign</h1>
                <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[#52525b]">{SUBTITLE[view]}</p>
                <p className="mt-1 text-[12px] text-[#71717a]">
                    {profile.startLabel ? `Start date ${profile.startLabel}` : 'Start date not set'}
                    {' · '}
                    {profile.owner ?? 'Owner not set'}
                    {' · Last update not set'}
                </p>
            </header>

            <div
                role="tablist"
                aria-label="Campaign"
                className="mt-4 flex gap-6 border-b border-[#e4e4e7]"
                onKeyDown={(event) => {
                    const current = VIEWS.findIndex(item => item.id === view);
                    const nextIndex = event.key === 'ArrowRight' || event.key === 'ArrowDown'
                        ? (current + 1) % VIEWS.length
                        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                            ? (current - 1 + VIEWS.length) % VIEWS.length
                            : event.key === 'Home'
                                ? 0
                                : event.key === 'End'
                                    ? VIEWS.length - 1
                                    : -1;
                    if (nextIndex < 0 || nextIndex === current) return;
                    event.preventDefault();
                    const next = VIEWS[nextIndex];
                    onView(next.id);
                    document.getElementById(`campaign-tab-${next.id}`)?.focus();
                }}
            >
                {VIEWS.map(item => {
                    const selected = view === item.id;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="tab"
                            id={`campaign-tab-${item.id}`}
                            aria-selected={selected}
                            aria-controls={`campaign-panel-${item.id}`}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => onView(item.id)}
                            className={cn(
                                'min-h-11 -mb-px border-b-2 px-0.5 text-[14px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#18181b]',
                                selected ? 'border-primary text-primary' : 'border-transparent text-[#71717a] hover:text-[#18181b]',
                            )}
                        >
                            {item.label}
                        </button>
                    );
                })}
            </div>

            <div
                role="tabpanel"
                id={`campaign-panel-${view}`}
                aria-labelledby={`campaign-tab-${view}`}
                className="mt-5"
            >
                {view === 'overview' && (
                    <OverviewBriefing
                        measurement={measurement}
                        initiatives={readyInitiatives}
                        message={workMessage}
                        today={today}
                        engagement={facts}
                        scope={scopeModel}
                        onView={onView}
                        onOpenInitiative={(id) => {
                            setSelectedInitiativeId(id);
                            onView('roadmap');
                        }}
                    />
                )}
                {view === 'roadmap' && (
                    <RoadmapPanel
                        initiatives={readyInitiatives}
                        today={today}
                        message={workMessage}
                        clientId={clientId}
                        organizationId={organizationId}
                        selectedId={selectedInitiativeId}
                        onSelect={setSelectedInitiativeId}
                        onSaved={(id) => {
                            setSelectedInitiativeId(id);
                            setReloadToken(token => token + 1);
                        }}
                    />
                )}
                {view === 'work' && (
                    <div className="space-y-8">
                        <ContentPlanSection
                            clientId={clientId}
                            organizationId={organizationId}
                            today={today}
                            month={contentPlanMonth}
                            rows={contentPlan}
                        />
                        {monthlyBoard}
                    </div>
                )}
                {view === 'results' && (
                    <Results measurement={measurement} initiatives={readyInitiatives} message={workMessage} today={today} />
                )}
            </div>
        </div>
    );
}

function Card({
    title,
    aside,
    children,
    className,
    region,
}: {
    title: string;
    aside?: ReactNode;
    children: ReactNode;
    className?: string;
    region?: string;
}) {
    return (
        <section data-region={region} className={cn('rounded-xl border border-[#e4e4e7] bg-white p-4', className)}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="min-w-0 text-[15px] font-semibold leading-5">{title}</h2>
                {aside && <p className="text-right text-[12px] text-[#71717a]">{aside}</p>}
            </div>
            <div className="mt-3">{children}</div>
        </section>
    );
}

function EmptyPlot({ caption }: { caption: string }) {
    return (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg bg-[#fdf2f8] px-6 py-8 text-center">
            <div className="max-w-md">
                <p className="text-[15px] font-medium">Not yet measurable</p>
                <p className="mt-1 text-[12px] leading-5 text-[#71717a]">{caption}</p>
            </div>
        </div>
    );
}

function Placeholder({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-4 border-b border-[#e4e4e7] py-2.5 last:border-b-0">
            <dt className="text-[13px] text-[#52525b]">{label}</dt>
            <dd className="text-right text-[13px] text-[#18181b]">{value}</dd>
        </div>
    );
}

function plotCaption(gsc: CampaignSitewide): string {
    if (gsc.reason === 'incomplete') return 'The stored 28-day window is incomplete. A missing observation is not zero.';
    return 'No baseline and no current window. A missing observation is not zero.';
}

function SitewideCard({ gsc }: { gsc: CampaignSitewide }) {
    const showSeries = gsc.status === 'measurable' && gsc.points.length > 0;
    const title = 'National Search Console · sitewide clicks';
    const caveat = 'Sitewide clicks include brand. They do not prove a priority-page goal. National Search Console and local Business Profile actions are not summed.';
    const source = gsc.status === 'measurable'
        ? `Source Google Search Console · sitewide property total · ${gsc.currentLabel} · as of ${gsc.asOf}. Daily totals for that window, not a rolling series. ${caveat}`
        : gsc.reason === 'incomplete'
            ? `The stored 28-day window is incomplete. ${caveat}`
            : gsc.reason === 'missing'
                ? `No final day is stored for this window. ${caveat}`
                : caveat;
    return (
        <Card region="sitewide" title={title} aside={showSeries && gsc.currentLabel ? gsc.currentLabel : 'Not yet measurable'}>
            {showSeries ? <SitewideChart gsc={gsc} /> : <EmptyPlot caption={plotCaption(gsc)} />}
            {gsc.baselineCaption ? <p className="mt-3 text-[12px] leading-5 text-[#52525b]">{gsc.baselineCaption}</p> : null}
            <p className="mt-3 text-[11px] leading-4 text-[#71717a]">{source}</p>
        </Card>
    );
}

function SitewideChart({ gsc }: { gsc: CampaignSitewide }) {
    const width = 640;
    const height = 200;
    const pad = { left: 12, right: 12, top: 16, bottom: 12 };
    const peak = Math.max(...gsc.points.map(point => point.clicks), gsc.baselineDaily ?? 0, 1);
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const xAt = (index: number) => pad.left + (gsc.points.length === 1 ? innerW / 2 : (index / (gsc.points.length - 1)) * innerW);
    const yAt = (value: number) => pad.top + (1 - value / (peak * 1.08)) * innerH;
    const coords = gsc.points.map((point, index) => ({ x: xAt(index), y: yAt(point.clicks) }));
    const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const floor = yAt(0);
    const first = coords[0];
    const last = coords[coords.length - 1];
    const area = first && last
        ? `${line} L${last.x.toFixed(1)},${floor.toFixed(1)} L${first.x.toFixed(1)},${floor.toFixed(1)} Z`
        : '';
    const baselineY = gsc.baselineDaily == null ? null : yAt(gsc.baselineDaily);
    const label = gsc.currentLabel
        ? `Daily sitewide clicks for ${gsc.currentLabel}. Total ${gsc.clicksLabel}.`
        : 'Daily sitewide clicks.';
    return (
        <div className="rounded-lg bg-[#fdf2f8] px-2 py-3" data-region="gsc-series">
            <p className="sr-only">{label}</p>
            <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="h-[200px] w-full">
                <title>{label}</title>
                {area ? <path d={area.trim()} fill="#fbcfe8" /> : null}
                {baselineY != null ? (
                    <line
                        data-baseline="true"
                        x1={pad.left}
                        x2={width - pad.right}
                        y1={baselineY}
                        y2={baselineY}
                        stroke="#b45309"
                        strokeWidth="1.5"
                        strokeDasharray="5 4"
                    />
                ) : null}
                {line ? <path d={line.trim()} fill="none" stroke="#ec4899" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
            </svg>
        </div>
    );
}

function pageGapCopy(result: CampaignPageResult): string | null {
    if (result.status === 'measurable') return null;
    if (result.reason === 'incomplete') return 'The stored 28-day window is incomplete. A missing observation is not zero.';
    if (result.reason === 'unavailable') return 'Search Console page clicks are not available for this view.';
    return 'No page series is stored for this window. A missing observation is not zero.';
}

function PageUrlCard({ results, urlsKnown }: { results: readonly CampaignPageResult[]; urlsKnown: boolean }) {
    const measured = results.find(result => result.status === 'measurable');
    const aside = measured?.currentLabel ?? 'Not yet measurable';
    return (
        <Card region="page-url" title="Page or URL result" aside={aside}>
            <div data-page-urls={results.length}>
                {results.length === 0 ? (
                    <>
                        {urlsKnown ? <p className="mb-2 text-[13px] leading-5 text-[#52525b]">No page URL is stored on an initiative.</p> : null}
                        <dl>
                            <Placeholder label="Comparison" value="Not yet measurable" />
                            <Placeholder label="Target" value="None set" />
                        </dl>
                    </>
                ) : (
                    <ul className="space-y-4">
                        {results.map(result => {
                            const missing = result.clicks == null;
                            const gap = pageGapCopy(result);
                            return (
                                <li
                                    key={result.initiativeIds[0] ?? result.url}
                                    data-page-result={result.initiativeIds[0]}
                                    data-state={result.status}
                                    data-reason={result.reason}
                                    data-surface={result.surface}
                                    {...(result.clicks == null ? {} : { 'data-clicks': String(result.clicks) })}
                                    className="border-b border-[#e4e4e7] pb-4 last:border-b-0 last:pb-0"
                                >
                                    <h3 className="text-[13px] font-medium leading-5 text-[#18181b]">{result.titles.join(' · ')}</h3>
                                    {/^https?:\/\//i.test(result.url) ? (
                                        <a href={result.url} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-[12px] text-[#52525b] underline-offset-2 hover:underline">
                                            {result.url}
                                        </a>
                                    ) : (
                                        <p className="mt-1 truncate text-[12px] text-[#52525b]">{result.url}</p>
                                    )}
                                    <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight" {...(missing ? { 'aria-hidden': true } : {})}>
                                        {missing ? '—' : result.clicksLabel}
                                    </p>
                                    <dl className="mt-2">
                                        <Placeholder label="Comparison" value={result.comparisonLabel} />
                                        <Placeholder label="Target" value="None set" />
                                    </dl>
                                    {result.baselineCaption ? <p className="mt-2 text-[12px] leading-5 text-[#52525b]">{result.baselineCaption}</p> : null}
                                    {gap ? <p className="mt-2 text-[12px] leading-5 text-[#71717a]">{gap}</p> : null}
                                    {result.surface === 'gbp_link' ? (
                                        <p className="mt-2 text-[12px] leading-5 text-[#71717a]">Search Console clicks on this Business Profile link. Not call-button taps.</p>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
                <p className="mt-3 text-[11px] leading-4 text-[#71717a]">
                    Google Search Console page clicks for a stored initiative URL. Sitewide clicks include brand and do not prove this page. Published is not indexed, and indexed is not performing. Not added to sitewide clicks or Business Profile.
                </p>
            </div>
        </Card>
    );
}

function Results({
    measurement,
    initiatives,
    message,
    today,
}: {
    measurement: CampaignMeasurement;
    initiatives: readonly CampaignInitiative[];
    message: string | null;
    today: string;
}) {
    const gbp = measurement.gbp;
    const gbpMissing = gbp.value == null;
    const pageResults = campaignPageResults({ series: measurement.pages, initiatives, today });
    return (
        <div className="space-y-4">
            <section data-region="measured" aria-labelledby="measured-results">
                <h2 id="measured-results" className="text-[15px] font-semibold">Measured results</h2>
                <div className="mt-3 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <SitewideCard gsc={measurement.gsc} />
                    <Card title="Local Business Profile">
                        <div data-metric="local-profile" data-state={gbp.status} {...(gbp.value == null ? {} : { 'data-clicks': String(gbp.value) })}>
                            <p className="text-[28px] font-semibold leading-none tracking-tight" {...(gbpMissing ? { 'aria-hidden': true } : {})}>{gbpMissing ? '—' : gbp.valueLabel}</p>
                            <p className="mt-2 text-[13px] text-[#52525b]">{gbp.label ?? 'Not yet measurable'}</p>
                            <p className="mt-3 text-[12px] leading-5 text-[#71717a]">
                                {gbp.windowLabel ? `${gbp.windowLabel}. ` : ''}
                                {gbp.priorValue != null && gbp.priorLabel ? `Prior month ${gbp.priorLabel} was ${gbp.priorValue}. ` : ''}
                                {gbp.status === 'measurable' ? 'Google Business Profile. ' : ''}
                                Separate from national Search Console. Not summed with sitewide clicks.
                            </p>
                        </div>
                    </Card>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <PageUrlCard results={pageResults} urlsKnown={message == null} />
                    <Card title="Secondary signal · rankings" aside="Not yet measurable">
                        <p className="text-[13px] leading-5 text-[#52525b]">Not yet measurable</p>
                        <p className="mt-2 text-[12px] leading-5 text-[#71717a]">
                            A missing observation is not a rank of zero.
                        </p>
                    </Card>
                </div>
            </section>

            <section data-region="completed" aria-labelledby="completed-work" className="pt-2">
                <h2 id="completed-work" className="text-[15px] font-semibold">Completed work</h2>
                <p className="mt-1 text-[12px] text-[#71717a]">Delivery and proof, not outcomes.</p>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <Card title="Completed delivery">
                        {message ? <p className="text-[13px] leading-5 text-[#52525b]">{message}</p> : <CompletedDeliveryList initiatives={initiatives} today={today} />}
                        <p className="mt-2 text-[12px] leading-5 text-[#71717a]">
                            Published is not indexed, and indexed is not performing.
                        </p>
                    </Card>
                    <Card title="Measurement gaps">
                        <p className="text-[13px] leading-5 text-[#52525b]">Nothing to list until a metric is defined.</p>
                    </Card>
                </div>
            </section>
        </div>
    );
}

function CompletedDeliveryList({
    initiatives,
    today,
}: {
    initiatives: readonly CampaignInitiative[];
    today: string;
}) {
    const deliveries = completedDeliveries(initiatives, today);
    if (deliveries.length === 0) {
        return <p className="text-[13px] leading-5 text-[#52525b]">No completed delivery is recorded on this view.</p>;
    }
    return (
        <ul className="space-y-4">
            {deliveries.map(item => (
                <li key={item.id} data-delivery={item.id} data-verification={item.verification} className="border-b border-[#e4e4e7] pb-3 last:border-b-0 last:pb-0">
                    <p className="text-[13px] font-medium leading-5 text-[#18181b]">{item.title}</p>
                    {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-[12px] text-[#52525b] underline-offset-2 hover:underline">
                            {item.url}
                        </a>
                    ) : null}
                    {item.dateLabel ? (
                        <p className="mt-1 text-[12px] text-[#71717a]">
                            {item.dateKind === 'published' ? 'Published' : 'Verified'} {item.dateLabel}
                        </p>
                    ) : null}
                    {item.verification === 'stale' ? (
                        <p data-tone="stale" className="mt-1 text-[12px] font-medium text-[#3f3f46]">Evidence stale — re-verify</p>
                    ) : (
                        <p data-tone="fresh" className="mt-1 text-[12px] font-medium text-[#15803d]">Completed & Verified</p>
                    )}
                </li>
            ))}
        </ul>
    );
}
