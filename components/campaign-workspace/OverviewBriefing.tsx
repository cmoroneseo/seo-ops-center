'use client';

import type { ReactNode } from 'react';
import { InitiativeMark, initiativeToneClass } from '@/components/campaign-workspace/initiative-status';
import {
    inProgressInitiatives,
    roadmapRows,
    type EngagementFacts,
    type ScopeBrief,
} from '@/lib/campaign-workspace/briefing';
import {
    completedDeliveries,
    initiativeDatesLabel,
    nextMilestone,
    statePresentation,
    type CampaignInitiative,
} from '@/lib/campaign-workspace/initiatives';
import { campaignPageResults, type CampaignPageResult } from '@/lib/campaign-workspace/pages';
import type { CampaignMeasurement, CampaignSitewide } from '@/lib/campaign-workspace/sources';
import type { CampaignView } from '@/lib/campaign-workspace/view';
import { cn } from '@/lib/utils';

function Band({
    kicker,
    title,
    question,
    action,
    children,
    className,
}: {
    kicker: string;
    title: string;
    question: string;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section data-band={kicker.toLowerCase()} data-question={question} className={cn('rounded-xl border border-[#e4e4e7] bg-white p-4', className)}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#71717a]">{kicker}</p>
                    <h2 className="mt-1 text-[15px] font-semibold leading-5 text-[#18181b]">{title}</h2>
                </div>
                {action}
            </div>
            <div className="mt-3">{children}</div>
        </section>
    );
}

function TextButton({ children, onClick }: { children: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="min-h-11 text-[13px] font-medium text-[#18181b] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18181b]"
        >
            {children}
        </button>
    );
}

function Fact({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-4 border-b border-[#e4e4e7] py-2 last:border-b-0">
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

function gapCopy(reason: string | undefined): string {
    if (reason === 'incomplete') return 'The stored 28-day window is incomplete. A missing observation is not zero.';
    if (reason === 'unavailable') return 'Search Console is not available for this view. A missing observation is not zero.';
    return 'No baseline and no current window. A missing observation is not zero.';
}

function pageGap(result: CampaignPageResult): string | null {
    if (result.status === 'measurable') return null;
    if (result.reason === 'incomplete') return 'The stored 28-day window is incomplete. A missing observation is not zero.';
    if (result.reason === 'unavailable') return 'Search Console page clicks are not available for this view.';
    return 'No page series is stored for this window. A missing observation is not zero.';
}

export function OverviewBriefing({
    measurement,
    initiatives,
    message,
    today,
    engagement,
    scope,
    onView,
    onOpenInitiative,
}: {
    measurement: CampaignMeasurement;
    initiatives: readonly CampaignInitiative[];
    message: string | null;
    today: string;
    engagement: EngagementFacts;
    scope: ScopeBrief | null;
    onView: (view: CampaignView) => void;
    onOpenInitiative: (id: string) => void;
}) {
    const rows = message ? [] : roadmapRows(initiatives, today);
    const verified = message ? [] : completedDeliveries(initiatives, today);
    const started = message ? [] : inProgressInitiatives(initiatives, today);
    const milestone = message ? null : nextMilestone(initiatives, today);
    const pages = campaignPageResults({ series: measurement.pages, initiatives, today });
    const gsc = measurement.gsc;
    const gbp = measurement.gbp;

    return (
        <div className="space-y-4">
            <Band
                kicker="Plan"
                question="roadmap"
                title="SEO Roadmap"
                action={<TextButton onClick={() => onView('roadmap')}>Open roadmap</TextButton>}
            >
                <p className="text-[13px] leading-5 text-[#52525b]">
                    Client-facing initiatives. Purpose, owner, dates, and page. Not the SEO Plan checklist, and not tasks.
                </p>
                {message ? <p className="mt-3 text-[13px] text-[#52525b]">{message}</p> : rows.length === 0 ? (
                    <p className="mt-3 text-[13px] text-[#52525b]">No initiatives yet.</p>
                ) : (
                    <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[40rem] border-collapse text-left text-[13px]">
                            <thead>
                                <tr className="border-b border-[#e4e4e7] text-[11px] font-medium uppercase tracking-wide text-[#71717a]">
                                    <th scope="col" className="py-2 pr-3 font-medium">Initiative</th>
                                    <th scope="col" className="py-2 pr-3 font-medium">Purpose</th>
                                    <th scope="col" className="py-2 pr-3 font-medium">Owner</th>
                                    <th scope="col" className="py-2 pr-3 font-medium">Dates</th>
                                    <th scope="col" className="py-2 font-medium">Page</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => (
                                    <tr key={row.id} data-roadmap-row={row.id} className="border-b border-[#f4f4f5] align-top last:border-b-0">
                                        <td className="py-2.5 pr-3">
                                            <span data-tone={row.tone} className={cn('text-[12px] font-medium', initiativeToneClass(row.tone))}>{row.stateLabel}</span>
                                            <p className="text-[#18181b]">{row.title}</p>
                                        </td>
                                        <td className="py-2.5 pr-3 text-[#3f3f46]">{row.purpose}</td>
                                        <td className="py-2.5 pr-3 text-[#3f3f46]">{row.owner}</td>
                                        <td className="whitespace-nowrap py-2.5 pr-3 text-[#3f3f46]">{row.dates}</td>
                                        <td className="max-w-[14rem] py-2.5 text-[#3f3f46]">
                                            {row.pageUrl ? (
                                                <a href={row.pageUrl} target="_blank" rel="noreferrer noopener" className="block truncate underline-offset-2 hover:underline">{row.pageUrl}</a>
                                            ) : 'Page not set'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Band>

            <div data-band="proof" className="space-y-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#71717a]">Proof</p>
                <div className="grid items-start gap-4 lg:grid-cols-2">
                    <section data-question="verified" className="rounded-xl border border-[#e4e4e7] bg-white p-4">
                        <h2 className="text-[15px] font-semibold leading-5">Completed & Verified</h2>
                        <p className="mt-1 text-[12px] leading-5 text-[#71717a]">
                            An evidence URL and a verification date. Proof older than 60 days is stale. A finished task is not this list.
                        </p>
                        {message ? <p className="mt-3 text-[13px] text-[#52525b]">{message}</p> : verified.length === 0 ? (
                            <p className="mt-3 text-[13px] text-[#52525b]">No completed delivery is recorded.</p>
                        ) : (
                            <ul className="mt-3 space-y-3">
                                {verified.map(item => (
                                    <li key={item.id} data-initiative={item.id} data-verification={item.verification} className="border-b border-[#f4f4f5] pb-3 last:border-b-0 last:pb-0">
                                        <p className="text-[13px] font-medium text-[#18181b]">{item.title}</p>
                                        {item.url ? (
                                            <a href={item.url} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-[12px] text-[#52525b] underline-offset-2 hover:underline">{item.url}</a>
                                        ) : null}
                                        {item.dateLabel ? (
                                            <p className="mt-1 text-[12px] text-[#71717a]">{item.dateKind === 'published' ? 'Published' : 'Verified'} {item.dateLabel}</p>
                                        ) : null}
                                        {item.verification === 'stale' ? (
                                            <p data-tone="stale" className="mt-1 text-[12px] font-medium text-[#3f3f46]">Evidence stale — re-verify</p>
                                        ) : (
                                            <p data-tone="fresh" className="mt-1 text-[12px] font-medium text-[#15803d]">Completed & Verified</p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="mt-3 text-[12px] leading-5 text-[#71717a]">Published is not indexed, and indexed is not performing.</p>
                    </section>

                    <section data-question="in-progress" className="rounded-xl border border-[#e4e4e7] bg-white p-4">
                        <h2 className="text-[15px] font-semibold leading-5">In progress</h2>
                        <p className="mt-1 text-[12px] leading-5 text-[#71717a]">
                            Initiatives that have started and are not verified yet. Task status is not this list.
                        </p>
                        <div className="mt-3" data-region="milestone" data-milestone={milestone?.initiativeId ?? 'none'}>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-[#71717a]">Next milestone</p>
                            {message ? <p className="mt-1 text-[13px] text-[#52525b]">{message}</p> : milestone ? (
                                <>
                                    <p className="mt-1 text-[13px] font-medium text-[#18181b]">{milestone.title}</p>
                                    <p className="mt-1 text-[12px] text-[#71717a]">{milestone.dateLabel} · {milestone.ownerLabel}</p>
                                    {milestone.items.length === 0 ? (
                                        <p className="mt-2 text-[13px] text-[#52525b]">No items yet</p>
                                    ) : (
                                        <ul className="mt-2 space-y-1">
                                            {milestone.items.map(item => (
                                                <li key={item.id} className="text-[13px] leading-5 text-[#18181b]">{item.stateLabel} · {item.title}</li>
                                            ))}
                                        </ul>
                                    )}
                                    <TextButton onClick={() => onOpenInitiative(milestone.initiativeId)}>View on roadmap</TextButton>
                                </>
                            ) : (
                                <p className="mt-1 text-[13px] text-[#18181b]">Not set yet</p>
                            )}
                        </div>
                        {message ? null : started.length === 0 ? (
                            <p className="mt-3 text-[13px] text-[#52525b]">No started initiative is waiting on verification.</p>
                        ) : (
                            <ul className="mt-3 space-y-3 border-t border-[#f4f4f5] pt-3">
                                {started.map(item => {
                                    const presentation = statePresentation(item, today);
                                    return (
                                        <li key={item.id} data-initiative={item.id} className="flex gap-2.5">
                                            <InitiativeMark tone={presentation.tone} />
                                            <div className="min-w-0">
                                                <p data-tone={presentation.tone} className={cn('text-[12px] font-medium', initiativeToneClass(presentation.tone))}>{presentation.label}</p>
                                                <p className="text-[13px] leading-5 text-[#18181b]">{item.title}</p>
                                                <p className="text-[12px] text-[#71717a]">{item.ownerName?.trim() || 'Owner not set'} · {initiativeDatesLabel(item)}</p>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                </div>

                <section
                    data-question="scope"
                    data-contract={engagement.contract}
                    data-hours-basis={scope?.hours.basis ?? 'unset'}
                    data-hours-promised={scope ? scope.hours.promisedHours ?? 'unset' : 'unset'}
                    data-hours-used={scope ? scope.hours.usedHours ?? 'unset' : 'unset'}
                    className="rounded-xl border border-[#e4e4e7] bg-white p-4"
                >
                    <h2 className="text-[15px] font-semibold leading-5">Scope this period</h2>
                    <p className="mt-1 text-[12px] leading-5 text-[#71717a]">
                        Hours and content against the contract. This is delivery, not SEO performance.
                    </p>
                    {scope == null ? (
                        <p className="mt-3 text-[13px] text-[#52525b]">Loading scope…</p>
                    ) : (
                        <div className="mt-3 grid gap-4 lg:grid-cols-2">
                            <div>
                                <h3 className="text-[13px] font-medium text-[#18181b]">
                                    {scope.hours.basis === 'engagement_total' ? 'Hours · engagement budget' : 'Hours · this month'}
                                </h3>
                                <dl className="mt-1">
                                    <Fact label="Period" value={scope.hours.periodText} />
                                    <Fact label="Promised" value={scope.hours.promisedText} />
                                    <Fact label="Logged" value={scope.hours.usedText} />
                                </dl>
                            </div>
                            <div>
                                <h3 className="text-[13px] font-medium text-[#18181b]">Content · {scope.monthLabel}</h3>
                                {scope.contentState === 'not_set' ? (
                                    <p className="mt-2 text-[13px] text-[#52525b]">Content scope is not set.</p>
                                ) : scope.contentState === 'not_measured' ? (
                                    <p className="mt-2 text-[13px] text-[#52525b]">Content scope is not measured.</p>
                                ) : (
                                    <ul className="mt-1">
                                        {scope.content.map(line => (
                                            <li
                                                key={line.type}
                                                data-content={line.type}
                                                data-promised={line.promised ?? 'unset'}
                                                data-delivered={line.delivered ?? 'unset'}
                                                className="border-b border-[#f4f4f5] py-2 last:border-b-0"
                                            >
                                                <p className="text-[13px] font-medium text-[#18181b]">{line.label}</p>
                                                <p className="text-[12px] text-[#52525b]">Promised {line.promisedText} · Delivered {line.deliveredText}</p>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}
                    {scope ? <p className="mt-3 text-[12px] leading-5 text-[#71717a]">{scope.hours.note}</p> : null}
                </section>
            </div>

            <Band
                kicker="Results"
                question="performance"
                title="Campaign performance"
                action={<TextButton onClick={() => onView('results')}>Open results</TextButton>}
            >
                <p className="text-[13px] leading-5 text-[#52525b]">
                    Measured results. Separate from delivery. Search Console and Business Profile are not added together.
                </p>
                <div className="mt-3 grid items-start gap-3 lg:grid-cols-3">
                    <article
                        data-region="sitewide"
                        data-metric="organic-clicks"
                        data-state={gsc.status}
                        data-reason={gsc.reason}
                        {...(gsc.clicks == null ? {} : { 'data-clicks': String(gsc.clicks) })}
                        className="rounded-lg bg-[#fafafa] px-3 py-3"
                    >
                        <h3 className="text-[12px] font-medium text-[#52525b]">Search Console · sitewide</h3>
                        <p className="mt-2 text-[22px] font-semibold leading-none tracking-tight text-[#18181b]" {...(gsc.clicks == null ? { 'aria-hidden': true } : {})}>{gsc.clicksLabel}</p>
                        <p className="mt-2 text-[12px] leading-5 text-[#52525b]">{clickDetail(gsc)}</p>
                        <p className="mt-2 text-[12px] leading-5 text-[#71717a]">
                            Includes brand. Same 28-day paired window as Search. Not added to Business Profile.
                            {gsc.status !== 'measurable' ? ` ${gapCopy(gsc.reason)}` : ''}
                        </p>
                    </article>
                    <article
                        data-metric="local-profile"
                        data-state={gbp.status}
                        {...(gbp.value == null ? {} : { 'data-clicks': String(gbp.value) })}
                        className="rounded-lg bg-[#fafafa] px-3 py-3"
                    >
                        <h3 className="text-[12px] font-medium text-[#52525b]">Business Profile</h3>
                        <p className="mt-2 text-[22px] font-semibold leading-none tracking-tight text-[#18181b]" {...(gbp.value == null ? { 'aria-hidden': true } : {})}>{gbp.value == null ? '—' : gbp.valueLabel}</p>
                        <p className="mt-2 text-[12px] leading-5 text-[#52525b]">{gbp.label ?? 'Not yet measurable'}</p>
                        <p className="mt-2 text-[12px] leading-5 text-[#71717a]">
                            {gbp.windowLabel ? `${gbp.windowLabel}. ` : ''}
                            Latest closed month only. Not added to Search Console.
                            {gbp.status !== 'measurable' ? ' A missing observation is not zero.' : ''}
                        </p>
                    </article>
                    <article data-region="page-url" data-page-urls={pages.length} className="rounded-lg bg-[#fafafa] px-3 py-3">
                        <h3 className="text-[12px] font-medium text-[#52525b]">Page or URL</h3>
                        {pages.length === 0 ? (
                            <p className="mt-2 text-[13px] leading-5 text-[#52525b]">
                                {message == null ? 'No page URL is stored on an initiative. Not yet measurable.' : 'Not yet measurable.'}
                            </p>
                        ) : (
                            <ul className="mt-2 space-y-3">
                                {pages.map(result => {
                                    const gap = pageGap(result);
                                    return (
                                        <li
                                            key={result.initiativeIds[0] ?? result.url}
                                            data-page-result={result.initiativeIds[0]}
                                            data-state={result.status}
                                            data-reason={result.reason}
                                            {...(result.clicks == null ? {} : { 'data-clicks': String(result.clicks) })}
                                        >
                                            <p className="text-[13px] font-medium leading-5 text-[#18181b]">{result.titles.join(' · ')}</p>
                                            <p className="truncate text-[12px] text-[#52525b]">{result.url}</p>
                                            <p className="mt-1 text-[13px] text-[#18181b]">{result.clicks == null ? '—' : result.clicksLabel}</p>
                                            <p className="text-[12px] text-[#71717a]">{result.comparisonLabel}</p>
                                            {gap ? <p className="text-[12px] leading-5 text-[#71717a]">{gap}</p> : null}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        <p className="mt-2 text-[12px] leading-5 text-[#71717a]">
                            Page clicks stay on this URL. Not added to sitewide clicks or Business Profile.
                        </p>
                    </article>
                </div>
            </Band>
        </div>
    );
}
