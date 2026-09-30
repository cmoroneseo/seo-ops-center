'use client';

// SEO Plan widget on the project-report canvas. The page is also the print/PDF,
// so colors stay on the fixed light palette used by the other report blocks.

import { useEffect, useState, type ReactNode } from 'react';
import type { Block } from '@/lib/reports/blocks';
import type { ClientProject, MarketingPlan, MarketingPlanItem } from '@/lib/types';
import { SEO_PLAN_LABEL } from '@/lib/marketing-plan-template';
import {
    fulfillmentCounts, planEngagementAnchor, planFulfillmentBuckets, readPlanReportView,
    type FulfillmentBucket, type FulfillmentCounts, type PlanReportView,
} from '@/lib/marketing-plan-logic';
import { getMarketingPlan } from '@/lib/supabase/marketing-plans';
import { createClient } from '@/lib/supabase/client';

const ACCENT = '#ef4444';

interface PlanBlockContext {
    client: ClientProject | null;
    hideEmpty: boolean;
    onEditText?: (blockId: string, patch: Record<string, unknown>) => void;
}

type LoadState =
    | { status: 'loading' }
    | { status: 'missing' }
    | { status: 'ready'; plan: MarketingPlan; taskDueDates: Record<string, string | null> };

export function MarketingPlanReportBlock({ block, ctx }: { block: Block; ctx: PlanBlockContext }) {
    const view = readPlanReportView(block.props.planView);
    const clientId = ctx.client?.id ?? null;
    const [loaded, setLoaded] = useState<LoadState>({ status: 'loading' });
    const [openState, setOpenState] = useState<{ signature: string; key: string | null } | null>(null);
    const [expandedFor, setExpandedFor] = useState<string | null>(null);

    useEffect(() => {
        if (!clientId) return;
        let cancelled = false;
        setLoaded({ status: 'loading' });
        (async () => {
            const plan = await getMarketingPlan(clientId);
            if (cancelled) return;
            if (!plan) {
                setLoaded({ status: 'missing' });
                return;
            }
            const taskIds = [...new Set(
                (plan.items ?? []).filter(item => item.taskId && !item.dueDate?.trim()).map(item => item.taskId as string),
            )];
            const taskDueDates: Record<string, string | null> = {};
            if (taskIds.length > 0) {
                const supabase = createClient();
                if (supabase) {
                    const { data } = await supabase.from('tasks').select('id, due_date').in('id', taskIds);
                    for (const row of (data ?? []) as { id: string; due_date: string | null }[]) {
                        taskDueDates[row.id] = row.due_date ? String(row.due_date).slice(0, 10) : null;
                    }
                }
            }
            if (!cancelled) setLoaded({ status: 'ready', plan, taskDueDates });
        })();
        return () => { cancelled = true; };
    }, [clientId]);

    if (!ctx.client) {
        return (
            <SectionFrame view={view} editable={!!ctx.onEditText} onChangeView={next => ctx.onEditText?.(block.id, { planView: next })}>
                <Note text="Select a client in Settings to show the SEO Plan." />
            </SectionFrame>
        );
    }

    if (loaded.status === 'loading') {
        return (
            <SectionFrame view={view} editable={!!ctx.onEditText} onChangeView={next => ctx.onEditText?.(block.id, { planView: next })}>
                <Note text={`Loading ${SEO_PLAN_LABEL}…`} />
            </SectionFrame>
        );
    }

    if (loaded.status === 'missing') {
        if (ctx.hideEmpty) return null;
        return (
            <SectionFrame view={view} editable={!!ctx.onEditText} onChangeView={next => ctx.onEditText?.(block.id, { planView: next })}>
                <Note text={`No ${SEO_PLAN_LABEL} yet for this client. Create one from the client workspace.`} />
            </SectionFrame>
        );
    }

    const items = loaded.plan.items ?? [];
    const counts = fulfillmentCounts(items);
    if (ctx.hideEmpty && counts.total === 0) return null;

    const buckets = planFulfillmentBuckets(items, loaded.plan.steps, view, {
        anchorDate: planEngagementAnchor({
            launchDateOverride: ctx.client.launchDateOverride,
            launchDate: ctx.client.launchDate,
            planCreatedAt: loaded.plan.createdAt,
        }),
        taskDueDates: loaded.taskDueDates,
    });
    const signature = `${view}:${loaded.plan.id}`;
    const openKey = openState?.signature === signature
        ? openState.key
        : (buckets.find(bucket => bucket.total > 0)?.key ?? buckets[0]?.key ?? null);

    return (
        <MarketingPlanReportBody
            view={view}
            counts={counts}
            buckets={buckets}
            openKey={openKey}
            expanded={expandedFor === signature}
            editable={!!ctx.onEditText}
            monthNote={view === 'month'
                ? 'Month 1 is the launch month (launch-date override, then launch date, then the day the plan was created). An item uses its due date, or the linked task\'s due date when the checklist item has none. Undated items are Unscheduled.'
                : null}
            onChangeView={next => ctx.onEditText?.(block.id, { planView: next })}
            onToggleBucket={key => setOpenState({ signature, key })}
            onToggleExpanded={() => setExpandedFor(expandedFor === signature ? null : signature)}
        />
    );
}

function reportItems(bucket: FulfillmentBucket): MarketingPlanItem[] {
    return bucket.items.filter(item => item.status !== 'ignored');
}

export function MarketingPlanReportBody({
    view, counts, buckets, openKey, expanded = false, editable, monthNote, onChangeView, onToggleBucket, onToggleExpanded,
}: {
    view: PlanReportView;
    counts: FulfillmentCounts;
    buckets: FulfillmentBucket[];
    openKey: string | null;
    /** Screen-only. Print always renders every group, ignoring this flag. */
    expanded?: boolean;
    editable: boolean;
    monthNote: string | null;
    onChangeView: (view: PlanReportView) => void;
    onToggleBucket: (key: string) => void;
    onToggleExpanded?: () => void;
}) {
    const open = buckets.find(bucket => bucket.key === openKey) ?? buckets[0] ?? null;
    const openItems = open ? reportItems(open) : [];
    const previewItem = openItems[0];
    const listedCount = buckets.reduce((sum, bucket) => sum + reportItems(bucket).length, 0);
    const showToggle = listedCount > (previewItem ? 1 : 0)
        || Boolean(previewItem?.description?.trim());

    return (
        <SectionFrame view={view} editable={editable} onChangeView={onChangeView}>
            <div className="grid grid-cols-3 items-center text-center mb-5">
                <Stat value={counts.total} label="Total" />
                <div className="flex flex-col items-center gap-1">
                    <ProgressRing percent={counts.progressPercent} />
                    <div className="text-sm font-semibold" style={{ color: '#111827' }}>{counts.done} of {counts.total}</div>
                    <div className="text-[10px] uppercase tracking-wide font-medium" style={{ color: '#16a34a' }}>Complete</div>
                </div>
                <Stat value={counts.todo} label="To do" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1" data-plan-view={view}>
                {buckets.map(bucket => {
                    const selected = bucket.key === openKey;
                    return (
                        <button
                            key={bucket.key}
                            type="button"
                            onClick={() => onToggleBucket(bucket.key)}
                            aria-expanded={selected}
                            className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm"
                            style={{ background: selected ? '#f3f4f6' : 'transparent', color: '#111827' }}
                        >
                            <span className="truncate">{bucket.label}</span>
                            <span className="shrink-0 font-medium" style={{ color: '#16a34a' }}>{bucket.done}/{bucket.total}</span>
                        </button>
                    );
                })}
            </div>

            {monthNote && (
                <p className="print-hidden mt-3 text-[11px] leading-snug" style={{ color: '#6b7280' }}>{monthNote}</p>
            )}

            {!expanded && open && (
                <div data-plan-checklist="preview" className="print-hidden mt-4 pt-3 border-t" style={{ borderColor: '#e5e7eb' }}>
                    <GroupHeading bucket={open} />
                    {previewItem ? (
                        <ul><ChecklistItem item={previewItem} showDescription={false} /></ul>
                    ) : (
                        <Note text="No checklist items in this group." />
                    )}
                    {showToggle && <ChecklistToggle expanded={false} onClick={() => onToggleExpanded?.()} />}
                </div>
            )}

            {/* Collapsed on screen this node is display:none via .print-only, then
                display:block inside @media print. Expanded, it is the on-screen list
                and still prints. The toggle itself is always print-hidden. */}
            <div
                data-plan-checklist="full"
                className={expanded ? 'mt-4 border-t' : 'print-only mt-4 border-t'}
                style={{ borderColor: '#e5e7eb' }}
            >
                {buckets.map(bucket => (
                    <GroupChecklist key={bucket.key} bucket={bucket} />
                ))}
                {expanded && showToggle && <ChecklistToggle expanded onClick={() => onToggleExpanded?.()} />}
            </div>
        </SectionFrame>
    );
}

function GroupHeading({ bucket }: { bucket: FulfillmentBucket }) {
    return (
        <div className="flex items-center justify-between gap-3 text-sm font-medium mb-2" style={{ color: '#111827' }}>
            <span>{bucket.label}</span>
            <span style={{ color: '#16a34a' }}>{bucket.done}/{bucket.total}</span>
        </div>
    );
}

function GroupChecklist({ bucket }: { bucket: FulfillmentBucket }) {
    const items = reportItems(bucket);
    return (
        <section className="pt-3">
            <GroupHeading bucket={bucket} />
            {items.length === 0 ? (
                <Note text="No checklist items in this group." />
            ) : (
                <ul>
                    {items.map(item => <ChecklistItem key={item.id} item={item} showDescription />)}
                </ul>
            )}
        </section>
    );
}

function ChecklistItem({ item, showDescription }: { item: MarketingPlanItem; showDescription: boolean }) {
    const done = item.status === 'done';
    return (
        <li className="flex items-start gap-2 text-sm py-2 border-b" style={{ borderColor: '#f3f4f6' }}>
            <span aria-hidden="true" className="mt-0.5" style={{ color: done ? '#16a34a' : '#9ca3af' }}>{done ? '✓' : '☐'}</span>
            <div className="min-w-0">
                <div className="font-medium" style={{ color: done ? '#6b7280' : '#111827' }}>{item.title}</div>
                {showDescription && item.description?.trim() && (
                    <p className="mt-1 text-[13px] leading-snug" style={{ color: '#6b7280' }}>{item.description}</p>
                )}
            </div>
        </li>
    );
}

function ChecklistToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
    return (
        <div className="print-hidden flex justify-center py-4">
            <button
                type="button"
                onClick={onClick}
                aria-expanded={expanded}
                className="text-[11px] font-semibold uppercase tracking-wide px-4 py-2 rounded-md border"
                style={{ borderColor: '#d1d5db', color: '#374151', background: '#fff' }}
            >
                {expanded ? 'Show less' : 'Show more'}
            </button>
        </div>
    );
}

function SectionFrame({
    view, editable, onChangeView, children,
}: {
    view: PlanReportView;
    editable: boolean;
    onChangeView: (view: PlanReportView) => void;
    children: ReactNode;
}) {
    return (
        <div>
            <div className="flex items-center gap-2 border-b-2 pb-2 mb-4" style={{ borderColor: ACCENT }}>
                <h2 className="text-lg font-semibold" style={{ color: '#111827' }}>{SEO_PLAN_LABEL}</h2>
                {editable && (
                    <div className="print-hidden ml-auto flex gap-1 text-xs" role="group" aria-label={`${SEO_PLAN_LABEL} grouping`}>
                        {(['step', 'month'] as const).map(mode => (
                            <button
                                key={mode}
                                type="button"
                                aria-pressed={view === mode}
                                onClick={() => onChangeView(mode)}
                                className="px-2 py-1 rounded"
                                style={{
                                    background: view === mode ? ACCENT : 'transparent',
                                    color: view === mode ? '#fff' : '#6b7280',
                                }}
                            >
                                {mode === 'step' ? 'Step' : 'Month'}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {children}
        </div>
    );
}

function Stat({ value, label }: { value: number; label: string }) {
    return (
        <div>
            <div className="text-3xl font-semibold" style={{ color: '#111827' }}>{value}</div>
            <div className="text-[10px] uppercase tracking-wide font-medium" style={{ color: '#6b7280' }}>{label}</div>
        </div>
    );
}

function ProgressRing({ percent }: { percent: number }) {
    const radius = 22;
    const circ = 2 * Math.PI * radius;
    const clamped = Math.min(100, Math.max(0, percent));
    const offset = circ - (clamped / 100) * circ;
    return (
        <div className="relative h-14 w-14">
            <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
                <circle cx="28" cy="28" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="5" />
                <circle
                    cx="28" cy="28" r={radius} fill="none" stroke="#16a34a" strokeWidth="5"
                    strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset} strokeLinecap="round"
                    transform="rotate(-90 28 28)"
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold" style={{ color: '#111827' }}>
                {clamped}%
            </span>
        </div>
    );
}

function Note({ text }: { text: string }) {
    return <p className="text-sm italic" style={{ color: '#9ca3af' }}>{text}</p>;
}
