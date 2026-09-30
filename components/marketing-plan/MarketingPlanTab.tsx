'use client';

import { useEffect, useState, useCallback } from 'react';
import { ClipboardList, FileDown, Plus, Printer, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarketingPlan, MarketingPlanItem, Task } from '@/lib/types';
import {
    getMarketingPlan, createMarketingPlanFromTemplate, addCustomItem, promoteItemToTask, updateMarketingPlanGoal,
} from '@/lib/supabase/marketing-plans';
import { createClient } from '@/lib/supabase/client';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { logActivity } from '@/lib/supabase/client-activity';
import { buildMarketingPlanExportHtml } from '@/lib/marketing-plan-export';
import {
    computePlanSummary, groupItems, filterItems, GroupMode,
} from '@/lib/marketing-plan-logic';
import { SummaryStrip } from './SummaryStrip';
import { StepRail } from './StepRail';
import { ItemRow, MemberOption } from './ItemRow';
import { AddItemForm } from './AddItemForm';
import { SuggestItemsPanel } from './SuggestItemsPanel';
import { ExecutionWorkspace, ExecutionTaskPatch, ScheduleFields } from './ExecutionWorkspace';
import { monthKey } from '@/lib/marketing-plan-execution';
import { getTask, updateTask } from '@/lib/supabase/tasks';
import { getTimeLogs } from '@/lib/supabase/time-logs';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';

interface MarketingPlanTabProps {
    organizationId: string;
    clientId: string;
    clientName: string;
    monthlyBudget?: number;
}

export function MarketingPlanTab({ organizationId, clientId, clientName, monthlyBudget = 0 }: MarketingPlanTabProps) {
    const [month, setMonth] = useState(monthKey);
    const [taskHours, setTaskHours] = useState<Record<string, number>>({});
    const [loggedHours, setLoggedHours] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [taskDetail, setTaskDetail] = useState<{ task: Task; complete?: boolean } | null>(null);
    const [timeVersion, setTimeVersion] = useState(0);
    const [plan, setPlan] = useState<MarketingPlan | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [groupMode, setGroupMode] = useState<GroupMode>('step');
    const [query, setQuery] = useState('');
    const [activeStepKey, setActiveStepKey] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [showSuggest, setShowSuggest] = useState(false);
    const [members, setMembers] = useState<MemberOption[]>([]);
    const [currentUser, setCurrentUser] = useState<{ id?: string; name: string }>({ name: 'Team' });

    const loadPlan = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const p = await getMarketingPlan(clientId);
            setPlan(p); setError(null);
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not load plan'); }
        finally { setLoading(false); }
    }, [clientId]);

    const refresh = useCallback(() => loadPlan(true), [loadPlan]);

    useEffect(() => { setPlan(null); loadPlan(); }, [loadPlan]);
    useEffect(() => {
        let cancelled = false;
        setLoggedHours(null);
        setTaskHours({});
        getTimeLogs(organizationId, { clientId, month, throwOnError: true }).then(logs => {
            if (cancelled) return;
            const budgetLogs = logs.filter(log => log.countsTowardBudget);
            setLoggedHours(budgetLogs.reduce((sum, log) => sum + log.hours, 0));
            setTaskHours(budgetLogs.reduce<Record<string, number>>((hours, log) => { if (log.taskId) hours[log.taskId] = (hours[log.taskId] ?? 0) + log.hours; return hours; }, {}));
        }).catch(() => { if (!cancelled) setLoggedHours(null); });
        return () => { cancelled = true; };
    }, [organizationId, clientId, month, timeVersion]);
    useEffect(() => {
        const reload = () => { void refresh(); setTimeVersion(value => value + 1); };
        window.addEventListener('focus', reload);
        window.addEventListener('timer:data-changed', reload);
        return () => { window.removeEventListener('focus', reload); window.removeEventListener('timer:data-changed', reload); };
    }, [refresh]);
    const openTask = async (task: Task, complete?: boolean) => {
        const result = await getTask(task.id);
        if (!result.task) { setError('Could not open task'); return; }
        setTaskDetail({ task: result.task, complete });
    };
    const saveTask = async (task: Task, patch: ExecutionTaskPatch) => {
        const result = await updateTask(task.id, { ...patch, updatedBy: currentUser.id });
        if (!result.success) throw new Error(result.error ?? 'Could not save task');
        await refresh();
    };
    const schedule = async (item: MarketingPlanItem, fields: ScheduleFields) => {
        const result = await promoteItemToTask(item, currentUser.name);
        if (!result.success || !result.taskId) throw new Error(result.error ?? 'Could not create task');
        const updated = await updateTask(result.taskId, { dueDate: fields.dueDate, assigneeIds: [fields.assigneeId], estimatedHours: fields.estimatedHours, updatedBy: currentUser.id });
        await refresh();
        if (!updated.success) throw new Error('Task is linked, but scheduling failed. Retry to update the same task. ' + (updated.error ?? ''));
    };

    useEffect(() => {
        if (!organizationId) return;
        getOrganizationMembers(organizationId).then(ms => {
            const opts = ms.map(m => ({
                userId: m.userId,
                displayName: m.user?.fullName ?? m.user?.email ?? 'Member',
            }));
            setMembers(opts);
            const supabase = createClient();
            if (!supabase) return;
            supabase.auth.getUser().then((res: Awaited<ReturnType<typeof supabase.auth.getUser>>) => {
                const uid = res.data.user?.id;
                if (!uid) return;
                const me = opts.find(o => o.userId === uid);
                setCurrentUser({ id: uid, name: me?.displayName ?? res.data.user?.email ?? 'Team' });
            });
        });
    }, [organizationId]);

    const handleCreate = async () => {
        setCreating(true);
        const res = await createMarketingPlanFromTemplate({ organizationId, clientId, clientName });
        if (res.success) {
            logActivity({ clientId, eventType: 'campaign.created', metadata: { source: 'marketing_plan_template' } });
        } else {
            alert(res.error ?? 'Failed to create plan');
        }
        setCreating(false);
        await loadPlan();
    };

    const handleAddItem = async (fields: {
        stepKey: string; title: string; description?: string;
        priority: 'high' | 'medium' | 'low';
    }) => {
        if (!plan) return;
        const maxSort = Math.max(0, ...(plan.items ?? []).map(i => i.sortOrder));
        const result = await addCustomItem({
            marketingPlanId: plan.id, organizationId, clientId,
            ...fields, sortOrder: maxSort + 1,
        });
        if (!result.success) throw new Error(result.error ?? 'Could not add item');
        setShowAddForm(false);
        refresh();
    };

    if (loading) {
        return <div className="text-center py-12 text-muted-foreground text-sm italic">Loading marketing plan…</div>;
    }

    if (error && !plan) return <div role="alert" className="space-y-3 rounded-xl border border-destructive/40 p-6"><p>Could not load your plan: {error}</p><button className="text-primary underline" onClick={() => loadPlan()}>Try again</button></div>;

    // Empty state
    if (!plan) {
        return (
            <div className="text-center py-16 space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <ClipboardList className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">Build a focused SEO plan</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Start with an SEO work library for {clientName}, then choose a few priorities
                    for your first month. Assign owners and dates as you schedule work.
                </p>
                <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                    <Plus className="h-4 w-4" />
                    {creating ? 'Creating…' : 'Create SEO Marketing Plan'}
                </button>
            </div>
        );
    }

    const items = plan.items ?? [];
    const summary = computePlanSummary(items);
    const visibleItems = filterItems(items, query);
    const groups = groupItems(visibleItems, plan.steps, groupMode)
        .filter(g => groupMode !== 'step' || !activeStepKey || g.key === activeStepKey);

    const GROUP_MODES: { key: GroupMode; label: string }[] = [
        { key: 'step', label: 'By Step' },
        { key: 'priority', label: 'By Priority' },
        { key: 'status', label: 'By Status' },
    ];

    const handleExport = (mode: 'pdf' | 'doc') => {
        const html = buildMarketingPlanExportHtml({ plan, clientName });
        if (mode === 'pdf') {
            const w = window.open('', '_blank');
            if (!w) { alert('Pop-up blocked — allow pop-ups to export PDF.'); return; }
            w.document.write(html);
            w.document.close();
            w.focus();
            setTimeout(() => w.print(), 300);
        } else {
            const blob = new Blob(['﻿' + html], { type: 'application/msword' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${clientName} - SEO Marketing Plan.doc`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    const fullPlan = (
        <div className="space-y-6" id="marketing-plan-root">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{plan.title}</h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => handleExport('pdf')}
                        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                        <Printer className="h-3.5 w-3.5" /> Export PDF
                    </button>
                    <button
                        onClick={() => handleExport('doc')}
                        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                        <FileDown className="h-3.5 w-3.5" /> Export Word
                    </button>
                </div>
            </div>

            <SummaryStrip summary={summary} />

            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
                <StepRail
                    steps={plan.steps}
                    items={items}
                    activeStepKey={activeStepKey}
                    onSelect={key => {
                        setGroupMode('step');
                        setActiveStepKey(prev => prev === key ? null : key);
                    }}
                />

                <div className="space-y-4 min-w-0">
                    {/* Toolbar */}
                    <div className="flex items-center gap-3 flex-wrap print:hidden">
                        <div className="flex items-center gap-1 border-b border-border/50">
                            {GROUP_MODES.map(m => (
                                <button
                                    key={m.key}
                                    onClick={() => { setGroupMode(m.key); setActiveStepKey(null); }}
                                    className={cn(
                                        'px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 -mb-px transition-colors',
                                        groupMode === m.key
                                            ? 'border-primary text-foreground'
                                            : 'border-transparent text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1" />
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <input
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Search by keyword..."
                                className="text-sm border border-border rounded-lg pl-8 pr-3 py-1.5 bg-card w-52"
                            />
                        </div>
                        <button
                            onClick={() => setShowSuggest(s => !s)}
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
                        >
                            <Sparkles className="h-4 w-4" /> Suggest Items
                        </button>
                        <button
                            onClick={() => setShowAddForm(f => !f)}
                            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-green-700 transition-colors"
                        >
                            <Plus className="h-4 w-4" /> Add Item
                        </button>
                    </div>

                    {showAddForm && (
                        <AddItemForm
                            steps={plan.steps}
                            defaultStepKey={activeStepKey ?? undefined}
                            onSubmit={handleAddItem}
                            onCancel={() => setShowAddForm(false)}
                        />
                    )}

                    {showSuggest && (
                        <SuggestItemsPanel
                            plan={plan}
                            clientName={clientName}
                            onAdded={refresh}
                            onClose={() => setShowSuggest(false)}
                        />
                    )}

                    {visibleItems.length === 0 && <div className="py-8 text-center"><p className="text-sm text-muted-foreground">No matching plan items.</p><button className="mt-3 text-sm text-primary underline" onClick={() => setQuery('')}>Clear search</button></div>}
                    {/* Groups */}
                    {groups.filter(group => !query || group.items.length > 0).map(group => {
                        const done = group.items.filter(i => i.status === 'done').length;
                        const countable = group.items.filter(i => i.status !== 'ignored').length;
                        return (
                            <section key={group.key} className="rounded-xl border border-border/50 bg-card px-5 py-2">
                                <div className="flex items-center justify-between py-3">
                                    <h4 className="font-bold text-base">{group.label}</h4>
                                    <span className="text-sm text-muted-foreground">
                                        <span className="text-primary font-semibold">{done}</span>/{countable}
                                    </span>
                                </div>
                                {group.items.length === 0 ? (
                                    <p className="text-sm text-muted-foreground italic pb-4">No items.</p>
                                ) : (
                                    group.items.map(item => (
                                        <ItemRow
                                            key={item.id}
                                            item={item}
                                            members={members}
                                            currentUser={currentUser}
                                            onChanged={refresh}
                                            onOpenTask={task => openTask(task)}
                                        />
                                    ))
                                )}
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );
    return <>
        {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/40 p-3 text-sm">{error}<button className="ml-3 text-primary underline" onClick={() => refresh()}>Retry</button></p>}
        <ExecutionWorkspace plan={plan} month={month} budget={monthlyBudget} loggedHours={loggedHours} taskHours={taskHours} members={members} fullPlan={fullPlan} onMonthChange={setMonth} onSaveTask={saveTask} onSchedule={schedule} onSaveGoal={async goal => { await updateMarketingPlanGoal(plan.id, goal); await refresh(); }} onOpenTask={openTask} />
        {taskDetail && <TaskDetailModal task={taskDetail.task} isOpen initialCompletion={taskDetail.complete} currentUserId={currentUser.id} onClose={() => { setTaskDetail(null); void refresh(); setTimeVersion(value => value + 1); }} onUpdate={() => { void refresh(); }} onDelete={() => { setTaskDetail(null); void refresh(); }} />}
    </>;

}
