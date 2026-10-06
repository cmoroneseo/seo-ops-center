'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MarketingPlanReportBody } from '@/components/reports/MarketingPlanReportBlock';
import { planEngagementAnchor, planFulfillmentBuckets, type PlanReportView } from '@/lib/marketing-plan-logic';
import { checklistPlan, type PlanDecisionState, type PortalFeedbackEntry, type PortalPlanItem, type PortalPlanStep } from '@/lib/portal/progress';
import { FeedbackThread } from './FeedbackThread';
import { usePortalView } from './PortalViewContext';

function when(iso?: string) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function PortalPlan({
    planId,
    title,
    steps,
    items,
    createdAt,
    organizationId,
    clientId,
    launchDate,
    state,
    askedAgain,
    decision,
    feedback,
}: {
    planId: string;
    title: string;
    steps: PortalPlanStep[];
    items: PortalPlanItem[];
    createdAt?: string;
    organizationId: string;
    clientId: string;
    launchDate?: string;
    state: PlanDecisionState;
    askedAgain: boolean;
    decision?: {
        decision: 'approved' | 'changes_requested';
        actorLabel: string;
        decidedAt: string;
        note?: string;
    };
    feedback: PortalFeedbackEntry[];
}) {
    const { readOnly } = usePortalView();
    const router = useRouter();
    const [view, setView] = useState<PlanReportView>('step');
    const [openKey, setOpenKey] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(true);
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<'approved' | 'changes_requested' | null>(null);

    const plan = useMemo(() => checklistPlan({
        planId, title, steps, items, createdAt, organizationId, clientId,
    }), [planId, title, steps, items, createdAt, organizationId, clientId]);

    const buckets = useMemo(() => planFulfillmentBuckets(plan.items ?? [], plan.steps, view, {
        anchorDate: planEngagementAnchor({ launchDate, planCreatedAt: createdAt }),
    }), [plan, view, launchDate, createdAt]);

    const counts = {
        done: items.filter(item => item.status === 'done').length,
        todo: items.filter(item => item.status === 'todo').length,
        ignored: 0,
        total: items.length,
        progressPercent: items.length === 0 ? 0 : Math.round((items.filter(item => item.status === 'done').length / items.length) * 100),
    };
    const activeKey = openKey ?? buckets.find(bucket => bucket.total > 0)?.key ?? buckets[0]?.key ?? null;

    async function decide(action: 'approved' | 'changes_requested') {
        if (readOnly) return;
        if (action === 'changes_requested' && !note.trim()) { setError('Tell your team what you’d like changed before sending.'); return; }
        setPending(action);
        setError(null);
        try {
            const response = await fetch('/api/client-portal/decision', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: action, note: note.trim() || undefined }),
            });
            const payload = await response.json().catch(() => null);
            if (response.status === 401) throw new Error('Your sign-in has expired. Sign in again to save your decision.');
            if (!response.ok) throw new Error(payload?.error ?? 'Could not save your decision. Please try again.');
            setNote(''); router.refresh();
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not save your decision. Please try again.');
        } finally { setPending(null); }
    }

    return (
        <div className="space-y-6">
            <div className="text-foreground"><h1 className="text-3xl font-bold tracking-tight">{title}</h1><p className="mt-3 text-sm text-muted-foreground">Your shared roadmap. Review the work ahead and let your team know what you think.</p></div>
            <div className="rounded-xl border border-border bg-white p-6 text-neutral-900">
                <MarketingPlanReportBody
                    view={view}
                    counts={counts}
                    buckets={buckets}
                    openKey={activeKey}
                    expanded={expanded}
                    editable
                    monthNote={view === 'month'
                        ? 'Month 1 is the month work started. Items are grouped by their due date. Items without a date are Unscheduled.'
                        : null}
                    onChangeView={setView}
                    onToggleBucket={setOpenKey}
                    onToggleExpanded={() => setExpanded(value => !value)}
                />
            </div>

            <section className="rounded-xl border border-border bg-card p-5">
                <h2 className="font-semibold">Your decision</h2>
                {askedAgain && (
                    <p className="mt-2 text-sm text-muted-foreground">Your team updated the plan and asked you to review it again.</p>
                )}
                {decision && (
                    <p className="mt-2 text-sm">
                        {decision.decision === 'approved' ? 'Approved' : 'Changes requested'} by {decision.actorLabel} on {when(decision.decidedAt)}.
                    </p>
                )}
                {state === 'awaiting' && !decision && (
                    <p className="mt-2 text-sm text-muted-foreground">The team is waiting on your approval.</p>
                )}
                <label className="mt-4 block text-sm font-medium">
                    Note for the team
                    <textarea
                        disabled={readOnly}
                        value={note}
                        onChange={event => setNote(event.target.value)}
                        rows={3}
                        maxLength={2000}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        placeholder={state === 'changes_requested' ? 'What should change?' : 'Optional, unless you are requesting changes'}
                    />
                </label>
                {error && <div role="alert" className="mt-2 text-sm text-destructive"><p>{error}</p>{error.includes('sign-in') && <a href="/portal/login?next=/portal/plan" className="mt-1 inline-block font-semibold underline">Sign in again</a>}</div>}
                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        type="button"
                        disabled={readOnly || pending !== null || state === 'approved'}
                        onClick={() => decide('approved')}
                        className="portal-button disabled:opacity-50"
                    >
                        {pending === 'approved' ? 'Saving…' : 'Approve'}
                    </button>
                    <button
                        type="button"
                        disabled={readOnly || pending !== null || state === 'changes_requested'}
                        onClick={() => decide('changes_requested')}
                        className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                    >
                        {pending === 'changes_requested' ? 'Saving…' : 'Request changes'}
                    </button>
                </div>
                {readOnly && <p className="mt-3 text-xs text-muted-foreground">Decisions are disabled in client preview.</p>}
                <FeedbackThread subjectType="plan" subjectId={planId} entries={feedback} />
            </section>
        </div>
    );
}
