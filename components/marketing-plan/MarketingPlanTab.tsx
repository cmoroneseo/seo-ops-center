'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { ClipboardList, FileDown, ListChecks, Plus, Printer, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarketingPlan, MarketingPlanItem, Task } from '@/lib/types';
import {
    createMarketingPlanFromTemplate, addCustomItem, addCatalogItem, promoteItemToTask, updateMarketingPlanGoal, promoteItemsToTasks, promoteItemsAsPillar, addExistingTaskToPlan,
} from '@/lib/supabase/marketing-plans';
import { loadMarketingPlan } from '@/lib/seo-plan/prefetch';
import { createClient } from '@/lib/supabase/client';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { logActivity } from '@/lib/supabase/client-activity';
import { buildMarketingPlanExportHtml } from '@/lib/marketing-plan-export';
import { displaySeoPlanTitle, SEO_PLAN_LABEL } from '@/lib/marketing-plan-template';
import {
    computePlanSummary, groupItems, filterItems, itemsEligibleForTaskGeneration, createTasksLabel, phaseItemsLabel, GroupMode,
} from '@/lib/marketing-plan-logic';
import { PanelSkeleton } from '@/components/seo-plan/PanelSkeleton';
import { AddPlanItemDialog } from './AddPlanItemDialog';
import { LibraryCatalogDialog } from './LibraryCatalogDialog';
import { isInRoadmap, ROADMAP_PHASES, roadmapItemsForPhase, type RoadmapPhase } from '@/lib/marketing-plan-roadmap';
import { SummaryStrip } from './SummaryStrip';
import { StepRail } from './StepRail';
import { ItemRow, MemberOption } from './ItemRow';
import { AddItemForm } from './AddItemForm';
import { SuggestItemsPanel } from './SuggestItemsPanel';
import { ExistingTaskDialog } from './ExistingTaskDialog';
import { GenerateTasksPanel } from './GenerateTasksPanel';
import { ExecutionWorkspace, ExecutionTaskPatch, ScheduleFields } from './ExecutionWorkspace';
import { monthKey } from '@/lib/marketing-plan-execution';
import type { HoursNarrative } from '@/lib/seo-plan/overview';
import {getSeoHoursForMonth} from '@/lib/supabase/change-log';
import { getTask, updateTask } from '@/lib/supabase/tasks';
import { getTimeLogs } from '@/lib/supabase/time-logs';
import {getAgreementHistory,getAgreementWorkFunding} from '@/lib/supabase/agreements';
import {monthlyAgreementLogs,monthlyAgreementTaskIds,agreementPeriod,agreementToday} from '@/lib/agreements/logic';
import {buildTimeline,commitmentChoices,phaseAnchor,phaseWorkFromItems,phaseWrite,roadmapAgreements,thisMonthBoard,type PhaseLog} from '@/lib/agreements/phase';
import type {ClientAgreement} from '@/lib/agreements/types';
import {SEO_PLAN_READ_ONLY_NOTE} from '@/lib/seo-plan/read-only';
import {AgreementTimeline} from '@/components/seo-plan/AgreementTimeline';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';

interface MarketingPlanTabProps {
    organizationId: string;
    clientId: string;
    clientName: string;
    monthlyBudget?: number | null;
    scopeMode?:'monthly'|'custom';
    presentation?: 'classic' | 'v2';
    hoursNarrative?: 'default' | HoursNarrative;
    /** GBP and listings checklist rows follow the client’s saved scope. */
    checklistScope?: { gbp?: boolean; listings?: boolean };
    /** Archived and cancelled clients cannot schedule or add plan items. v2 only. */
    readOnly?: boolean;
    /** Agreements already on the client, so the roadmap keeps the root clock if the refresh fails. */
    knownAgreements?: ClientAgreement[] | null;
}

export function MarketingPlanTab({ organizationId, clientId, clientName, monthlyBudget = 0,scopeMode='monthly', presentation = 'classic', hoursNarrative = 'default', checklistScope, readOnly = false, knownAgreements = null }: MarketingPlanTabProps) {
    const [addChooserOpen, setAddChooserOpen] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [basecampOnly, setBasecampOnly] = useState(false);
    const [planLayout, setPlanLayout] = useState<'list' | 'board'>(presentation === 'v2' ? 'board' : 'list');
    const [roadmapMonth, setRoadmapMonth] = useState<'all' | RoadmapPhase>('all');
    const [existingOpen, setExistingOpen] = useState(false);
    const [month, setMonth] = useState(monthKey);
    const [periodBudget,setPeriodBudget]=useState(monthlyBudget ?? 0);
    const [capacityMode,setCapacityMode]=useState<'monthly'|'scoped'|'unavailable'>('unavailable');
    const [budgetTaskIds,setBudgetTaskIds]=useState<string[]|undefined>();
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
    const [taskDraft, setTaskDraft] = useState<{ label: string; items: MarketingPlanItem[] } | null>(null);
    const [creatingTasks, setCreatingTasks] = useState(false);
    const creatingTasksRef = useRef(false);
    const [taskDraftError, setTaskDraftError] = useState<string | null>(null);
    const [members, setMembers] = useState<MemberOption[]>([]);
    const [currentUser, setCurrentUser] = useState<{ id?: string; name: string }>({ name: 'Team' });
    const [agreementRows, setAgreementRows] = useState<ClientAgreement[] | null>(null);
    const [agreementsFailed, setAgreementsFailed] = useState(false);
    const [timelineLogs, setTimelineLogs] = useState<PhaseLog[] | null>(null);
    const [timelineLogsFailed, setTimelineLogsFailed] = useState(false);

    const loadSequence = useRef(0);
    const loadPlan = useCallback(async (silent = false) => {
        const sequence = ++loadSequence.current;
        if (!silent) setLoading(true);
        try {
            const p = await loadMarketingPlan(clientId, silent);
            if (sequence === loadSequence.current) { setPlan(p); setError(null); }
        } catch (e) { if (sequence === loadSequence.current) setError(e instanceof Error ? e.message : 'Could not load plan'); }
        finally { if (sequence === loadSequence.current) setLoading(false); }
    }, [clientId]);

    const refresh = useCallback(() => loadPlan(true), [loadPlan]);

    useEffect(() => { setPlan(null); loadPlan(); return () => { loadSequence.current++; }; }, [loadPlan]);
    useEffect(() => {
        const query = new URLSearchParams(window.location.search);
        const phase = query.get('phase');
        if (phase && ROADMAP_PHASES.some(([key]) => key === phase)) {
            setPlanLayout('board');
            setRoadmapMonth(phase as RoadmapPhase);
        }
        const overviewMonth = query.get('overviewMonth');
        if (overviewMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(overviewMonth)) setMonth(overviewMonth);
    }, [clientId]);
    useEffect(() => {
        let cancelled = false;
        setLoggedHours(null);
        setTaskHours({});
        setCapacityMode('unavailable');
        Promise.all([getTimeLogs(organizationId, { clientId, month, budgetMonth: true, throwOnError: true }),getAgreementHistory(organizationId,clientId)]).then(async([logs,history]) => {
            const period=history.agreements.length ? agreementPeriod(history.agreements,month) : null;
            const hours=period ? period.monthlyBudget : scopeMode==='monthly' ? await getSeoHoursForMonth(organizationId,clientId,month,monthlyBudget ?? 0) : null;
            const mode=period ? hours==null || period.uncoveredDays>0 || period.segments.some(s=>s.agreement.mode==='custom') ? 'scoped' : 'monthly' : scopeMode==='custom' ? 'scoped' : 'monthly';
            const funding=period ? await getAgreementWorkFunding(organizationId,clientId) : [];
            if (cancelled) return;
            setPeriodBudget(hours ?? 0);setCapacityMode(mode);
            setBudgetTaskIds(period && mode==='monthly' ? monthlyAgreementTaskIds((plan?.items ?? []).flatMap(item=>item.linkedTask ? [item.linkedTask] : []),history.agreements,funding,month) : undefined);
            const budgetLogs = period && mode==='monthly' ? monthlyAgreementLogs(logs,history.agreements,month) : logs.filter(log => log.countsTowardBudget);
            setLoggedHours(budgetLogs.reduce((sum, log) => sum + log.hours, 0));
            setTaskHours(budgetLogs.reduce<Record<string, number>>((hours, log) => { if (log.taskId) hours[log.taskId] = (hours[log.taskId] ?? 0) + log.hours; return hours; }, {}));
        }).catch(() => { if (!cancelled) setLoggedHours(null); });
        return () => { cancelled = true; };
    }, [organizationId, clientId, month, timeVersion,monthlyBudget,scopeMode,plan]);
    useEffect(() => {
        setAgreementRows(null);
        setAgreementsFailed(false);
        setTimelineLogs(null);
        setTimelineLogsFailed(false);
    }, [clientId, organizationId]);
    useEffect(() => {
        if (presentation !== 'v2') return;
        let cancelled = false;
        Promise.all([
            getAgreementHistory(organizationId, clientId).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
            getTimeLogs(organizationId, { clientId, throwOnError: true }).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
        ]).then(([historyResult, logsResult]) => {
            if (cancelled) return;
            const historyOk = historyResult.ok && historyResult.value.available;
            setAgreementsFailed(!historyOk);
            setAgreementRows(historyOk ? historyResult.value.agreements : null);
            setTimelineLogsFailed(!logsResult.ok);
            setTimelineLogs(logsResult.ok ? logsResult.value.map(log => ({ taskId: log.taskId, date: log.date, hours: log.hours, countsTowardBudget: log.countsTowardBudget })) : null);
        });
        return () => { cancelled = true; };
    }, [presentation, organizationId, clientId, timeVersion]);
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
        const scheduledSource = roadmapAgreements({ fetched: agreementRows, failed: agreementsFailed, known: knownAgreements });
        const scheduledPhase = presentation === 'v2' && scheduledSource.agreements ? phaseWrite(phaseAnchor(scheduledSource.agreements), fields.dueDate, null) : {};
        const updated = await updateTask(result.taskId, { dueDate: fields.dueDate, assigneeIds: [fields.assigneeId], estimatedHours: fields.estimatedHours, ...scheduledPhase, updatedBy: currentUser.id });
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
        const res = await createMarketingPlanFromTemplate(presentation === 'v2'
            ? { organizationId, clientId, clientName, seed: 'onboarding', scope: checklistScope }
            : { organizationId, clientId, clientName });
        if (res.success) {
            logActivity({ clientId, eventType: 'campaign.created', metadata: { source: 'marketing_plan_template' } });
        } else {
            alert(res.error ?? 'Failed to create plan');
        }
        setCreating(false);
        await loadPlan(true);
    };

    const openTaskDraft = (label: string, source: MarketingPlanItem[]) => {
        const eligible = itemsEligibleForTaskGeneration(source);
        if (eligible.length === 0) return;
        setTaskDraftError(null);
        setTaskDraft({ label, items: eligible });
    };

    const handleCreateTasks = async (chosen: MarketingPlanItem[], pillar: { title: string } | null) => {
        if (creatingTasksRef.current || !plan) return;
        creatingTasksRef.current = true;
        setCreatingTasks(true);
        setTaskDraftError(null);
        try {
            if (pillar) {
                const grouped = await promoteItemsAsPillar(plan.id, chosen, { title: pillar.title, actorName: currentUser.name });
                await refresh();
                if (!grouped.success) {
                    setTaskDraftError(grouped.error ?? 'Could not create the pillar');
                    return;
                }
                setTaskDraft(null);
                if (grouped.warning) alert(grouped.warning);
                return;
            }
            const result = await promoteItemsToTasks(chosen, currentUser.name);
            await refresh();
            if (result.failed.length === 0) {
                setTaskDraft(null);
                return;
            }
            const detail = result.failed.map(f => `${f.title}: ${f.error}`).join('; ');
            const summary = result.created.length === 0
                ? `No tasks created. ${detail}`
                : `Created ${result.created.length}. ${result.failed.length} failed — ${detail}`;
            if (result.created.length === 0) setTaskDraftError(summary);
            else {
                setTaskDraft(null);
                alert(summary);
            }
        } finally {
            creatingTasksRef.current = false;
            setCreatingTasks(false);
        }
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
            ...(presentation === 'v2' ? { source: 'custom' as const } : {}),
        });
        if (!result.success) throw new Error(result.error ?? 'Could not add item');
        setShowAddForm(false);
        refresh();
    };

    if (loading) {
        return <PanelSkeleton label={`Loading ${SEO_PLAN_LABEL}`} />;
    }

    if (error && !plan) return <div role="alert" className="space-y-3 rounded-xl border border-destructive/40 p-6"><p>Could not load your plan: {error}</p><button className="text-primary underline" onClick={() => loadPlan()}>Try again</button></div>;

    // Empty state
    if (!plan) {
        return (
            <div className="text-center py-16 space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <ClipboardList className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">{presentation === 'v2' ? 'Start the onboarding checklist' : 'Build a focused SEO plan'}</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    {presentation === 'v2'
                        ? `Create the onboarding checklist for ${clientName}. Other work stays in the library until you add it.`
                        : `Start with an SEO work library for ${clientName}, then choose a few priorities for your first month. Assign owners and dates as you schedule work.`}
                </p>
                <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                    <Plus className="h-4 w-4" />
                    {creating ? 'Creating…' : `Create ${SEO_PLAN_LABEL}`}
                </button>
            </div>
        );
    }

    const items = plan.items ?? [];
    const summary = computePlanSummary(items.filter(isInRoadmap));
    const visibleItems = filterItems(items, query);
    const countedItems = planLayout === 'board' && roadmapMonth !== 'all'
        ? roadmapItemsForPhase(visibleItems.filter(item => !activeStepKey || item.stepKey === activeStepKey), roadmapMonth)
        : visibleItems;
    const visibleEligible = itemsEligibleForTaskGeneration(countedItems);
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
            a.download = `${clientName} - ${SEO_PLAN_LABEL}.doc`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    const classicPlan = (
        <div className="space-y-6" id="marketing-plan-root">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{displaySeoPlanTitle(plan.title)}</h3>
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
            <div className="flex rounded-lg border border-border p-1 w-fit" role="group" aria-label="SEO Plan layout">
                {(['list', 'board'] as const).map(layout => <button key={layout} aria-pressed={planLayout === layout} onClick={() => setPlanLayout(layout)} className={cn('rounded-md px-4 py-2 text-sm font-medium', planLayout === layout ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{layout === 'list' ? 'List' : 'Kanban board'}</button>)}
            </div>

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
                            onClick={() => openTaskDraft(
                                activeStepKey
                                    ? (plan.steps.find(s => s.key === activeStepKey)?.name ?? 'This step')
                                    : 'Visible items',
                                visibleItems,
                            )}
                            disabled={visibleEligible.length === 0 || creatingTasks}
                            title={visibleEligible.length === 0 ? 'No to-do items left to turn into tasks' : undefined}
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                        >
                            <ListChecks className="h-4 w-4" />
                            {createTasksLabel(visibleEligible.length)}
                        </button>
                        {readOnly ? <p className="text-sm text-muted-foreground">{SEO_PLAN_READ_ONLY_NOTE}</p> : <button onClick={() => setAddChooserOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-green-700"><Plus className="h-4 w-4" /> Add Item</button>}
                    </div>

                    {showAddForm && (
                        <AddItemForm
                            steps={plan.steps}
                            defaultStepKey={activeStepKey ?? undefined}
                            onSubmit={handleAddItem}
                            onCancel={() => setShowAddForm(false)}
                        />
                    )}

                    {taskDraft && (
                        <GenerateTasksPanel
                            key={taskDraft.items.map(item => item.id).join(',')}
                            scopeLabel={taskDraft.label}
                            items={taskDraft.items}
                            creating={creatingTasks}
                            error={taskDraftError}
                            onConfirm={handleCreateTasks}
                            onClose={() => { if (!creatingTasks) setTaskDraft(null); }}
                        />
                    )}

                    {showSuggest && (
                        <SuggestItemsPanel
                            plan={plan}
                            clientName={clientName}
                            onAdded={refresh}
                            onClose={() => setShowSuggest(false)}
                            source={presentation === 'v2' ? 'custom' : undefined}
                        />
                    )}

                    {visibleItems.length === 0 && <div className="py-8 text-center"><p className="text-sm text-muted-foreground">No matching plan items.</p><button className="mt-3 text-sm text-primary underline" onClick={() => setQuery('')}>Clear search</button></div>}
                    {/* Groups */}
                    {planLayout === 'list' ? groups.filter(group => !query || group.items.length > 0).map(group => {
                        const done = group.items.filter(i => isInRoadmap(i) && i.status === 'done').length;
                        const countable = group.items.filter(isInRoadmap).length;
                        const eligible = itemsEligibleForTaskGeneration(group.items);
                        return (
                            <section key={group.key} className="rounded-xl border border-border/50 bg-card px-5 py-2">
                                <div className="flex items-center justify-between gap-3 py-3">
                                    <h4 className="font-bold text-base">{group.label}</h4>
                                    <div className="flex items-center gap-3">
                                        {eligible.length > 0 && (
                                            <button
                                                onClick={() => openTaskDraft(group.label, group.items)}
                                                disabled={creatingTasks}
                                                className="print:hidden text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                                            >
                                                {createTasksLabel(eligible.length)}
                                            </button>
                                        )}
                                        <span className="text-sm text-muted-foreground">
                                            <span className="text-primary font-semibold">{done}</span>/{countable}
                                        </span>
                                    </div>
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
                    }) : <div className="space-y-4">
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Roadmap phase filter">
                            <button aria-pressed={roadmapMonth === 'all'} onClick={() => setRoadmapMonth('all')} className={cn('rounded-lg border px-3 py-2 text-sm', roadmapMonth === 'all' && 'border-primary text-primary')}>All phases</button>
                            {ROADMAP_PHASES.map(([key, label]) => <button key={key} aria-pressed={roadmapMonth === key} onClick={() => setRoadmapMonth(key)} className={cn('rounded-lg border px-3 py-2 text-sm', roadmapMonth === key && 'border-primary text-primary')}>{label}</button>)}
                        </div>
                        <p className="text-xs text-muted-foreground">Selected roadmap work, relative to launch. Backlog is unsequenced; task due dates stay separate.</p>
                        <div className={cn('grid gap-4', roadmapMonth === 'all' && 'xl:grid-cols-2 2xl:grid-cols-4')}>
                            {ROADMAP_PHASES.filter(([key]) => roadmapMonth === 'all' || roadmapMonth === key).map(([key, label]) => {
                                const phaseItems = roadmapItemsForPhase(visibleItems.filter(item => !activeStepKey || item.stepKey === activeStepKey), key);
                                const phaseOpen = itemsEligibleForTaskGeneration(phaseItems).length;
                                return <section key={key} className="min-w-0 rounded-xl border border-border bg-muted/30 p-4"><div className="mb-3 flex items-center justify-between"><h4 className="font-semibold">{label}</h4><span className="text-xs text-muted-foreground">{phaseItemsLabel(phaseItems.length, phaseOpen)}</span></div>{phaseItems.length ? phaseItems.map(item => <div key={item.id} className="mb-3 rounded-lg border border-border bg-card px-3"><ItemRow item={item} members={members} currentUser={currentUser} onChanged={refresh} onOpenTask={task => openTask(task)} /></div>) : <p className="py-6 text-sm text-muted-foreground">No selected work in this phase.</p>}</section>;
                            })}
                        </div>
                    </div>}
                </div>
            </div>
        </div>
    );
    const agreementSource = roadmapAgreements({ fetched: agreementRows, failed: agreementsFailed, known: knownAgreements });
    const anchor = agreementSource.agreements ? phaseAnchor(agreementSource.agreements) : null;
    const today = agreementToday(agreementSource.agreements?.find(item => !item.cancelledAt)?.timezone ?? 'America/Los_Angeles');
    const phaseWork = phaseWorkFromItems(items, ids => ids.length ? ids.map(id => members.find(member => member.userId === id)?.displayName ?? 'Team member').join(', ') : 'Unassigned');
    const timeline = presentation === 'v2' ? buildTimeline({ work: phaseWork, agreements: agreementSource.failed ? null : agreementSource.agreements, agreementsFailed: agreementSource.failed, today, logs: timelineLogs, logsFailed: timelineLogsFailed }) : null;
    const board = presentation === 'v2' ? thisMonthBoard(phaseWork, { anchor, today, month }) : null;
    const taskById = new Map(items.flatMap(item => item.linkedTask ? [[item.linkedTask.id, item.linkedTask] as const] : []));
    const phaseMonth = board ? {
        needsDate: board.needsDate.flatMap(id => { const task = taskById.get(id); return task ? [task] : []; }),
        due: board.due.flatMap(id => { const task = taskById.get(id); return task ? [task] : []; }),
        slipped: board.slipped.flatMap(row => { const task = taskById.get(row.id); return task ? [{ task, slipLabel: row.slipLabel }] : []; }),
    } : null;
    const phaseChoices = timeline?.columns.filter(column => column.key === 'onboarding' || column.key.startsWith('month_')).map(column => ({ value: column.key, label: column.title })) ?? [];
    const fullPlan = presentation === 'v2' && timeline ? <AgreementTimeline model={timeline} /> : classicPlan;
    return <>
        {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/40 p-3 text-sm">{error}<button className="ml-3 text-primary underline" onClick={() => refresh()}>Retry</button></p>}
        <ExecutionWorkspace readOnly={readOnly} onAddExisting={() => { if (!readOnly) setAddChooserOpen(true); }} plan={plan} month={month} budget={periodBudget} capacityMode={capacityMode} budgetTaskIds={budgetTaskIds} loggedHours={loggedHours} taskHours={taskHours} members={members} fullPlan={fullPlan} onMonthChange={setMonth} onSaveTask={saveTask} onSchedule={schedule} onSaveGoal={async goal => { await updateMarketingPlanGoal(plan.id, goal); await refresh(); }} onOpenTask={openTask} variant={presentation} hoursNarrative={presentation !== 'v2' ? 'default' : hoursNarrative === 'prelaunch' ? 'prelaunch' : capacityMode === 'unavailable' ? 'unavailable' : hoursNarrative === 'custom' || capacityMode === 'scoped' ? 'custom' : 'monthly'} phaseMonth={phaseMonth} recordPhase={presentation === 'v2' && agreementSource.agreements !== null} phaseAnchorDate={anchor} phaseChoices={phaseChoices} commitmentOptions={agreementSource.agreements ? commitmentChoices(agreementSource.agreements) : []} />
        <AddPlanItemDialog showLibrary={presentation === 'v2'} open={addChooserOpen} onClose={() => setAddChooserOpen(false)} onSelect={source => {
            if (source === 'library') setLibraryOpen(true);
            else if (source === 'custom') setShowAddForm(true);
            else if (source === 'suggest') setShowSuggest(true);
            else { setBasecampOnly(source === 'basecamp'); setExistingOpen(true); }
        }} />
        <LibraryCatalogDialog
            open={libraryOpen}
            existing={(plan?.items ?? []).map(item => ({ templateKey: item.templateKey, title: item.title }))}
            onClose={() => setLibraryOpen(false)}
            onAdd={async title => {
                if (!plan) return;
                const maxSort = Math.max(0, ...(plan.items ?? []).map(item => item.sortOrder));
                const result = await addCatalogItem({
                    marketingPlanId: plan.id,
                    organizationId,
                    clientId,
                    title,
                    sortOrder: maxSort + 1,
                    existing: (plan.items ?? []).map(item => ({ templateKey: item.templateKey, title: item.title })),
                });
                if (!result.success) throw new Error(result.error ?? 'Could not add that item.');
                refresh();
            }}
        />
        {existingOpen && <ExistingTaskDialog open basecampOnly={basecampOnly} plan={plan} month={month} onClose={() => setExistingOpen(false)} onAttach={async (task, step, due) => {
            await addExistingTaskToPlan(plan.id, task.id, step);
            const result = await updateTask(task.id, { dueDate: due, updatedBy: currentUser.id });
            await refresh();
            if (!result.success) throw new Error('Task is linked, but the due date could not be saved. Update it in Tasks.');
        }} />}
        {taskDetail && <TaskDetailModal task={taskDetail.task} isOpen initialCompletion={taskDetail.complete} currentUserId={currentUser.id} onClose={() => { setTaskDetail(null); void refresh(); setTimeVersion(value => value + 1); }} onUpdate={() => { void refresh(); }} onDelete={() => { setTaskDetail(null); void refresh(); }} />}
    </>;

}
