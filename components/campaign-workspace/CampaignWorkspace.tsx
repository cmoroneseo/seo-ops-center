'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { campaignWorkspaceEnabled } from '@/lib/campaign-workspace/flag';
import { loadCampaignMeasurement } from '@/lib/campaign-workspace/load';
import {
    campaignIdentity,
    EMPTY_CAMPAIGN_MEASUREMENT,
    type CampaignIdentity,
    type CampaignMeasurement,
    type CampaignSitewide,
} from '@/lib/campaign-workspace/sources';
import { type CampaignView } from '@/lib/campaign-workspace/view';
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
    { id: 'results', label: 'Results' },
];

const SUBTITLE: Record<CampaignView, string> = {
    overview: 'Scope, goals, owners, and the next measurement window for this engagement.',
    roadmap: 'Initiatives connect purpose, delivery, and evidence.',
    results: 'Measured outcomes stay separate from completed delivery.',
};

export function CampaignWorkspace({
    clientName,
    view,
    onView,
    organizationId,
    clientId,
    identity,
    snapshot,
}: {
    clientName: string;
    view: CampaignView;
    onView: (view: CampaignView) => void;
    organizationId?: string;
    clientId?: string;
    identity?: CampaignIdentity;
    /** Set in tests. When present, the view does not read live sources. */
    snapshot?: CampaignMeasurement;
}) {
    const [loaded, setLoaded] = useState<CampaignMeasurement | null>(null);
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

    if (!campaignWorkspaceEnabled()) return null;
    const name = clientName.trim() || 'This client';
    const measurement = snapshot ?? loaded ?? EMPTY_CAMPAIGN_MEASUREMENT;
    const profile = identity ?? campaignIdentity({});

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
                    {profile.startLabel ? `Start date ${profile.startLabel}` : 'Start date not set'} · Last update not set
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
                {view === 'overview' && <Overview identity={profile} measurement={measurement} />}
                {view === 'roadmap' && <Roadmap />}
                {view === 'results' && <Results measurement={measurement} />}
            </div>
        </div>
    );
}

function Card({
    title,
    aside,
    children,
    className,
}: {
    title: string;
    aside?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section className={cn('rounded-xl border border-[#e4e4e7] bg-white p-4', className)}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="min-w-0 text-[15px] font-semibold leading-5">{title}</h2>
                {aside && <p className="text-right text-[12px] text-[#71717a]">{aside}</p>}
            </div>
            <div className="mt-3">{children}</div>
        </section>
    );
}

function Kpi({
    label,
    value,
    detail,
    metric,
    clicks,
}: {
    label: string;
    value: string;
    detail: string;
    metric?: string;
    clicks?: number | null;
}) {
    const missing = value === '—';
    return (
        <section
            className="rounded-xl border border-[#e4e4e7] bg-white px-4 py-3.5"
            {...(metric ? { 'data-metric': metric } : {})}
            {...(clicks == null ? {} : { 'data-clicks': String(clicks) })}
        >
            <h2 className="text-[13px] font-medium text-[#52525b]">{label}</h2>
            <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-[#18181b]" {...(missing ? { 'aria-hidden': true } : {})}>{value}</p>
            <p className="mt-2 text-[12px] text-[#71717a]">{detail}</p>
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

function clickDetail(gsc: CampaignSitewide): string {
    if (gsc.status !== 'measurable') return 'Not yet measurable';
    if (gsc.deltaLabel && gsc.currentLabel) return `${gsc.deltaLabel} · ${gsc.currentLabel}`;
    if (gsc.currentLabel) return `Last 28 days · ${gsc.currentLabel}`;
    return 'Not yet measurable';
}

function plotCaption(gsc: CampaignSitewide): string {
    if (gsc.reason === 'incomplete') return 'The stored 28-day window is incomplete. A missing observation is not zero.';
    return 'No baseline and no current window. A missing observation is not zero.';
}

function SitewideCard({ gsc, variant }: { gsc: CampaignSitewide; variant: 'overview' | 'results' }) {
    const showSeries = gsc.status === 'measurable' && gsc.points.length > 0;
    const title = variant === 'overview' ? 'Sitewide organic clicks' : 'National Search Console · sitewide clicks';
    const caveat = variant === 'overview'
        ? 'Sitewide clicks, once measured, include brand and do not by themselves prove a priority-page goal.'
        : 'Sitewide clicks include brand. They do not prove a priority-page goal. National Search Console and local Business Profile actions are not summed.';
    const source = gsc.status === 'measurable'
        ? `Source Google Search Console · sitewide property total · ${gsc.currentLabel} · as of ${gsc.asOf}. Daily totals for that window, not a rolling series. ${caveat}`
        : gsc.reason === 'incomplete'
            ? `The stored 28-day window is incomplete. ${caveat}`
            : gsc.reason === 'missing'
                ? `No final day is stored for this window. ${caveat}`
                : variant === 'overview'
                    ? `Source is not connected for this view. ${caveat}`
                    : caveat;
    return (
        <Card title={title} aside={showSeries && gsc.currentLabel ? gsc.currentLabel : 'Not yet measurable'}>
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

function Overview({ identity, measurement }: { identity: CampaignIdentity; measurement: CampaignMeasurement }) {
    const approval = measurement.awaitingApproval;
    return (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                    <Kpi
                        label="Organic clicks"
                        metric="organic-clicks"
                        value={measurement.gsc.clicksLabel}
                        clicks={measurement.gsc.clicks}
                        detail={clickDetail(measurement.gsc)}
                    />
                    <Kpi label="Action needed" value="—" detail="Not set yet" />
                    <Kpi
                        label="Awaiting approval"
                        metric="awaiting-approval"
                        value={approval == null ? '—' : String(approval)}
                        clicks={approval}
                        detail={approval == null ? 'Not set yet' : approval === 0 ? 'None waiting' : 'Content awaiting a decision'}
                    />
                </div>

                <SitewideCard gsc={measurement.gsc} variant="overview" />

                <Card title="Goals & planning scope">
                    <dl>
                        <Placeholder label="Scope" value={identity.scope ?? 'Not set yet'} />
                        <Placeholder label="Goals" value="Not set yet" />
                        <Placeholder label="Planning aim" value="Not set yet" />
                        <Placeholder label="Owners" value={identity.owner ?? 'Not set yet'} />
                    </dl>
                    <p className="mt-3 text-[12px] leading-5 text-[#71717a]">
                        Delivery expectations are not set yet.
                    </p>
                </Card>
            </div>

            <div className="space-y-4">
                <Card title="Next milestone" aside="Not set">
                    <p className="text-[13px] text-[#18181b]">Not set yet</p>
                    <dl className="mt-3">
                        <Placeholder label="Owner" value="Not set yet" />
                        <Placeholder label="Checklist" value="No items yet" />
                    </dl>
                </Card>

                <Card title="Action needed">
                    <p className="text-[13px] leading-5 text-[#52525b]">No client action is waiting.</p>
                </Card>

                <section className="rounded-xl border border-[#e4e4e7] bg-white p-4" data-region="initiatives">
                    <h2 className="text-[15px] font-semibold leading-5">Key initiatives</h2>
                    <p className="mt-3 text-[13px] leading-5 text-[#52525b]">No initiatives yet.</p>
                </section>
            </div>
        </div>
    );
}

function Roadmap() {
    return (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                    <div role="radiogroup" aria-label="Roadmap layout" className="inline-flex rounded-lg bg-[#ececef] p-1">
                        <button
                            type="button"
                            role="radio"
                            aria-checked="false"
                            disabled
                            title="Board is not available yet"
                            className="min-h-11 cursor-not-allowed rounded-md px-3 text-[13px] text-[#a1a1aa]"
                        >
                            Board
                        </button>
                        <button
                            type="button"
                            role="radio"
                            aria-checked="true"
                            className="min-h-11 rounded-md bg-white px-3 text-[13px] font-medium text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18181b]"
                        >
                            Timeline
                        </button>
                    </div>
                    <p className="text-[12px] text-[#71717a]">Board is not available yet.</p>
                </div>

                <div className="rounded-xl border border-[#e4e4e7] bg-white" data-region="timeline">
                    <div className="border-b border-[#e4e4e7] px-4 py-3 text-[12px] font-medium text-[#71717a]">
                        Initiative / why it matters
                    </div>
                    <p className="px-4 py-16 text-center text-[13px] leading-5 text-[#52525b]">
                        No initiatives yet. Dates are not set, so there is no bar.
                    </p>
                </div>
            </div>

            <Card title="Initiative detail">
                <p className="text-[13px] text-[#52525b]">No initiative selected.</p>
                <dl className="mt-2">
                    <Placeholder label="Purpose" value="Not set yet" />
                    <Placeholder label="Delivery checklist" value="No deliverables yet" />
                    <Placeholder label="Measurement" value="Not yet measurable" />
                </dl>
                <p className="mt-3 text-[12px] leading-5 text-[#71717a]">
                    Published work is delivery, not a measured result.
                </p>
            </Card>
        </div>
    );
}

function Results({ measurement }: { measurement: CampaignMeasurement }) {
    const gbp = measurement.gbp;
    const gbpMissing = gbp.value == null;
    return (
        <div className="space-y-4">
            <section data-region="measured" aria-labelledby="measured-results">
                <h2 id="measured-results" className="text-[15px] font-semibold">Measured results</h2>
                <div className="mt-3 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <SitewideCard gsc={measurement.gsc} variant="results" />
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
                    <Card title="Page or URL result" aside="Not yet measurable">
                        <dl>
                            <Placeholder label="Comparison" value="Not yet measurable" />
                            <Placeholder label="Target" value="None set" />
                        </dl>
                    </Card>
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
                        <p className="text-[13px] leading-5 text-[#52525b]">No completed delivery is recorded on this view.</p>
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
