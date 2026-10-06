'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Check, ClipboardCheck, ExternalLink, FileText, Layers, TrendingUp, Target, MessageSquare } from 'lucide-react';
import { labelSubtype, type PortalDeliverable, type PortalPendingItem } from '@/lib/portal/progress';
import { first90Days, upcomingWeeks, portalDate, type PortalPerformanceMonth } from '@/lib/portal/dashboard';
import type { PortalPlanView, PortalReportSummary } from '@/lib/portal/data';
import { monthLabel } from '@/lib/reports/sections';
import { PortalPerformance } from './PortalPerformance';

const STATUS = { in_progress: 'In progress', in_review: 'In review', approved: 'Approved · awaiting delivery', published: 'Published', delivered: 'Delivered' };

function PendingLink({ item, children, className }: { item: PortalPendingItem; children: React.ReactNode; className?: string }) {
    return item.external ? <a className={className} href={item.href}>{children}</a> : <Link className={className} href={item.href}>{children}</Link>;
}

export function PortalHome({ waiting, inProgress, shipped, latestReport, plan, performance, clientName, launchDate, today }: {
    waiting: PortalPendingItem[]; inProgress: PortalDeliverable[]; shipped: PortalDeliverable[];
    latestReport: PortalReportSummary | null; plan: PortalPlanView; performance: PortalPerformanceMonth[];
    clientName: string; launchDate?: string; today: string;
}) {
    const [workView, setWorkView] = useState<'shipped' | 'in_progress'>('shipped');
    const [showAll, setShowAll] = useState(false);
    const milestones = first90Days(plan.items, launchDate);
    const weeks = upcomingWeeks(plan.items, today);
    const currentMilestone = milestones?.findIndex(milestone => today >= milestone.start && today <= milestone.end) ?? -1;
    const icons = [Layers, TrendingUp, Target];
    const work = workView === 'shipped' ? shipped : [...inProgress].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    const visibleWork = showAll ? work : work.slice(0, 6);
    const overdue = plan.items.filter(item => item.status === 'todo' && item.dueDate && item.dueDate < today);
    const undated = plan.items.filter(item => item.status === 'todo' && !item.dueDate);
    const doneThisMonth = shipped.filter(item => (item.deliveredOn?.slice(0, 7) ?? item.month) === today.slice(0, 7)).length;
    return (
        <div>
            <section className="portal-hero">
                <h1>Here’s where we’re taking your growth.</h1>
                <p className="portal-hero-description">Your SEO journey, made clear. See what’s shipped, what’s moving forward, and how you can help keep {clientName} growing.</p>
                <div className="portal-journey">
                    {(milestones ?? [0, 1, 2].map(index => ({ label: `Days ${index * 30 + 1}–${(index + 1) * 30}`, items: [], completed: 0 }))).map((milestone, index) => {
                        const Icon = icons[index];
                        const done = milestone.items.length > 0 && milestone.completed === milestone.items.length;
                        const current = index === currentMilestone && !done;
                        return <Link key={milestone.label} href="#first-90-days" data-state={done ? 'done' : current ? 'current' : 'upcoming'}>
                            <span className="portal-journey-icon">{done ? <Check size={24} /> : <Icon size={24} aria-hidden="true" />}</span>
                            <div><p className="portal-journey-title">{milestone.label}</p><p className="portal-journey-note">{milestone.items.length ? `${milestone.completed} of ${milestone.items.length} planned activities complete` : 'Milestones to be confirmed with your team'}{current && <span className="block font-semibold text-foreground">Your current milestone window</span>}</p></div>
                        </Link>;
                    })}
                </div>
            </section>

            <div className="portal-top-grid">
                <PortalPerformance months={performance} />
                <section className="portal-panel portal-next" aria-labelledby="next-heading">
                    <div className="flex items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><ClipboardCheck size={24} aria-hidden="true" /></span><div><h2 id="next-heading">Your next move</h2><p className="portal-panel-description">{waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'item needs' : 'items need'} you to keep things moving.` : 'You’re all caught up. Your team has the next move.'}</p></div></div>
                    {waiting.length > 0 ? <ul className="mt-5 space-y-3">{waiting.slice(0, 3).map(item => <li key={`${item.kind}-${item.id}`} className="flex items-center gap-3 rounded-lg bg-card p-3.5"><FileText size={22} className="shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0 flex-1"><h3 className="text-xs font-bold leading-relaxed">{item.title}</h3>{item.detail && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{item.detail}</p>}</div><PendingLink item={item} className="portal-button px-3 py-2">{item.kind === 'waiting_item' ? 'Respond' : 'Review'}<span className="sr-only">: {item.title}</span></PendingLink></li>)}</ul> : <div className="my-6 flex items-start gap-3 rounded-lg bg-card p-4"><Check size={21} className="shrink-0 text-emerald-700 dark:text-emerald-400" /><p className="text-xs leading-relaxed text-muted-foreground">No approvals or requests are waiting on you. New requests will appear here.</p></div>}
                    {waiting.length > 3 && <Link href="/portal/pending" className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-primary">View all {waiting.length} requests <ArrowRight size={14} /></Link>}
                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-card px-4 py-3 text-xs"><Check size={17} className="text-emerald-700 dark:text-emerald-400" /><p><strong>{doneThisMonth} {doneThisMonth === 1 ? 'deliverable' : 'deliverables'} shipped</strong> this month</p></div>
                    <Link href="/portal/messages#message-compose" className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary"><MessageSquare size={14} aria-hidden="true" />Have a question? Message your team</Link>
                </section>
            </div>

            <section aria-labelledby="work-heading">
                <div className="portal-section-heading"><div><h2 id="work-heading">Progress you can see</h2><p>Real work from your campaign. Shipped work covers this month and last.</p></div>{latestReport && <Link href={`/portal/reports/${latestReport.id}`}>View {monthLabel(latestReport.reportMonth)} report <ArrowRight size={14} className="inline" /></Link>}</div>
                <div className="portal-work-tabs mb-3" aria-label="Show deliverables"><button type="button" aria-pressed={workView === 'shipped'} onClick={() => { setWorkView('shipped'); setShowAll(false); }}>Shipped ({shipped.length})</button><button type="button" aria-pressed={workView === 'in_progress'} onClick={() => { setWorkView('in_progress'); setShowAll(false); }}>In progress ({inProgress.length})</button><Link className="px-2 py-2 text-[11px] text-muted-foreground hover:underline" href="/portal/pending">Waiting on you ({waiting.length})</Link></div>
                {visibleWork.length ? <div className="portal-work-grid">{visibleWork.map(item => <article key={item.id} className="portal-panel portal-work"><div className="flex flex-wrap items-center gap-2"><span className="portal-status" data-status={item.bucket === 'shipped' ? 'done' : 'progress'}>{item.bucket === 'shipped' && <Check size={11} />}{STATUS[item.status]}</span><span className="text-[10px] text-muted-foreground">{item.bucket === 'shipped' ? item.deliveredOn ? portalDate(item.deliveredOn) : item.month ? monthLabel(item.month) : 'Delivery date to be confirmed' : item.dueDate ? `Due ${portalDate(item.dueDate)}` : 'Due date to be confirmed'}</span></div><h3>{item.title}</h3><p className="portal-work-meta">{labelSubtype(item.subtype) ?? item.type}{item.month && ` · ${monthLabel(item.month)}`}</p>{item.publishedUrl && <a href={item.publishedUrl} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" target="_blank" rel="noopener noreferrer">View published work <ExternalLink size={12} /><span className="sr-only">: {item.title} (opens a new tab)</span></a>}</article>)}</div> : <div className="portal-panel portal-empty"><p className="font-semibold text-foreground">{workView === 'shipped' ? 'Your shipped work will appear here' : 'No deliverables are in progress right now'}</p><p className="mt-1">{workView === 'shipped' ? 'As your team publishes or delivers work, this becomes a record of what’s changed.' : 'Check your plan for the next scheduled activities, or ask your team for an update.'}</p></div>}
                {work.length > 6 && <button type="button" onClick={() => setShowAll(value => !value)} className="mt-3 text-xs font-semibold text-primary hover:underline">{showAll ? 'Show recent work' : `Show all ${work.length} deliverables`}</button>}
            </section>

            <section className="portal-panel mt-6" aria-labelledby="weeks-heading"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><h2 id="weeks-heading">The weeks ahead</h2><p className="portal-panel-description">Upcoming due dates from your shared SEO plan.</p></div><Link href="/portal/plan" className="text-xs font-semibold text-primary hover:underline">See the full plan →</Link></div>
                {plan.shared && plan.items.length > 0 ? <><div className="portal-week-grid">{weeks.map((week, index) => <div key={week.start} className="portal-week"><h3 className="text-xs font-bold">{index === 0 ? 'This week' : `Week ${index + 1}`}</h3><p className="mt-1 text-[10px] text-muted-foreground">{portalDate(week.start).replace(/, \d{4}/, '')} – {portalDate(week.end).replace(/, \d{4}/, '')}</p>{week.items.length ? <ul>{week.items.map(item => <li key={item.id} data-category={item.stepKey}><Link href="/portal/plan" className="hover:underline">{item.title}</Link><span className="mt-1 block text-[10px] text-muted-foreground">Due {portalDate(item.dueDate).replace(/, \d{4}/, '')}</span></li>)}</ul> : <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">No activities dated for this week.</p>}</div>)}</div>{(overdue.length > 0 || undated.length > 0) && <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{overdue.length > 0 && `${overdue.length} ${overdue.length === 1 ? 'activity is' : 'activities are'} past the planned date. `}{undated.length > 0 && `${undated.length} ${undated.length === 1 ? 'activity needs' : 'activities need'} a confirmed date. `}<Link href="/portal/messages" className="font-semibold text-primary hover:underline">Ask your team for a timing update.</Link></p>}</> : <p className="portal-empty">Your upcoming activities will appear when your team shares a dated SEO plan.</p>}
            </section>

            <section id="first-90-days" className="portal-panel mt-6 scroll-mt-6" aria-labelledby="milestones-heading"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><h2 id="milestones-heading">Your first 90 days</h2><p className="portal-panel-description">{launchDate ? `Starting ${portalDate(launchDate)} · milestones follow the dates in your shared plan.` : 'Your team will confirm your campaign start date and milestones.'}</p></div><Link href="/portal/plan" className="text-xs font-semibold text-primary hover:underline">Review your plan →</Link></div>
                {milestones && plan.shared ? <div className="mt-5 grid gap-5 md:grid-cols-3">{milestones.map(milestone => <div key={milestone.label}><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">{milestone.label}</h3><span className="text-xs text-muted-foreground">{milestone.completed}/{milestone.items.length} complete</span></div><p className="mt-1 text-[10px] text-muted-foreground">{portalDate(milestone.start)} – {portalDate(milestone.end)}</p>{milestone.items.length ? <ul className="mt-3 space-y-2">{milestone.items.map(item => <li key={item.id} className="flex items-start gap-2 text-xs leading-relaxed"><span className="mt-0.5 shrink-0">{item.status === 'done' ? <Check size={14} className="text-emerald-700 dark:text-emerald-400" /> : <span className="mt-0.5 block h-2.5 w-2.5 rounded-full border border-muted-foreground" />}</span><span><span className="sr-only">{item.status === 'done' ? 'Completed: ' : 'Planned: '}</span>{item.title}</span></li>)}</ul> : <p className="mt-3 text-xs leading-relaxed text-muted-foreground">No milestones have been dated in this window yet.</p>}</div>)}</div> : <p className="mt-5 text-sm leading-relaxed text-muted-foreground">Once your start date and SEO plan are shared, you’ll be able to follow your first three months here.</p>}
            </section>
        </div>
    );
}
