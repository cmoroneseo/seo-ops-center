'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Info, ListTodo, Loader2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { MarketingPlan, MarketingPlanItem, Task } from '@/lib/types';
import { executionCapacity, monthlyExecution, taskIsComplete, TASK_STATUS_LABELS } from '@/lib/marketing-plan-execution';
import type { MemberOption } from './ItemRow';

export interface ExecutionTaskPatch {
    assigneeIds?: string[];
    dueDate?: string;
    estimatedHours?: number | null;
    status?: Task['status'];
    description?: string;
}
export interface ScheduleFields { dueDate: string; assigneeId: string; estimatedHours: number }
export interface ExecutionWorkspaceProps {
    plan: MarketingPlan;
    month: string;
    budget: number;
    loggedHours: number | null;
    taskHours: Record<string, number>;
    members: MemberOption[];
    fullPlan: ReactNode;
    onAddExisting: () => void;
    onMonthChange: (month: string) => void;
    onSaveTask: (task: Task, patch: ExecutionTaskPatch) => Promise<void>;
    onSchedule: (item: MarketingPlanItem, fields: ScheduleFields) => Promise<void>;
    onSaveGoal: (goal: string) => Promise<void>;
    onOpenTask: (task: Task, complete?: boolean) => void;
}

const field = 'w-full min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50';
const secondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';
const formatHours = (value: number) => `${Number(value.toFixed(1))}h`;
const shortDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No due date';

function Status({ task }: { task: Task }) {
    return <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', taskIsComplete(task) ? 'text-green-500' : task.status === 'blocked' ? 'text-amber-500' : task.status === 'in_progress' ? 'text-primary' : 'text-muted-foreground')}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{TASK_STATUS_LABELS[task.status]}
    </span>;
}

export function ExecutionWorkspace({ plan, month, budget, loggedHours, taskHours, members, fullPlan, onAddExisting, onMonthChange, onSaveTask, onSchedule, onSaveGoal, onOpenTask }: ExecutionWorkspaceProps) {
    const [view, setView] = useState<'month' | 'full' | 'results'>('month');
    const [selectedId, setSelectedId] = useState<string>();
    const [scheduling, setScheduling] = useState(false);
    const [editingGoal, setEditingGoal] = useState(false);
    const [goal, setGoal] = useState(plan.goal ?? '');
    const [goalError, setGoalError] = useState('');
    const [savingGoal, setSavingGoal] = useState(false);
    const summary = monthlyExecution(plan.items ?? [], month, budget);
    const { plannedHours, consumed, available, scale } = executionCapacity(summary.tasks, taskHours, loggedHours, budget);
    const selected = summary.tasks.find(task => task.id === selectedId) ?? summary.tasks[0];
    const source = plan.items?.find(item => item.taskId === selected?.id);
    const title = new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const changeMonth = (offset: number) => {
        const date = new Date(`${month}-01T12:00:00`);
        date.setMonth(date.getMonth() + offset);
        onMonthChange(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
        setSelectedId(undefined);
    };
    return <div className="space-y-4">
<header className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">SEO Marketing Plan</p><h2 className="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">{title}</h2>
            <div className="mt-3 flex gap-3"><div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Plan goal</p>
                {editingGoal ? <form className="mt-2 space-y-2" onSubmit={async event => {
                    event.preventDefault(); setSavingGoal(true); setGoalError('');
                    try { await onSaveGoal(goal); setEditingGoal(false); } catch (error) { setGoalError(error instanceof Error ? error.message : 'Could not save goal'); } finally { setSavingGoal(false); }
                }}><label className="sr-only" htmlFor="plan-goal">Plan goal</label><input id="plan-goal" className={field} value={goal} maxLength={500} onChange={e => setGoal(e.target.value)} autoFocus disabled={savingGoal} placeholder="What should this SEO work achieve?" /><div className="flex gap-2"><button disabled={savingGoal} className={primary}>{savingGoal ? 'Saving…' : 'Save goal'}</button><button type="button" disabled={savingGoal} className={secondary} onClick={() => { setEditingGoal(false); setGoalError(''); }}>Cancel</button></div>{goalError && <p role="alert" className="text-sm text-destructive">{goalError}</p>}</form>
                : <button className="mt-1 text-left text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => { setGoal(plan.goal ?? ''); setEditingGoal(true); }}>{plan.goal || 'Set a goal for this plan'}<span className="ml-2 text-xs font-normal text-muted-foreground">Edit</span></button>}
            </div></div>
</div>            <section aria-label="Monthly capacity" className="min-w-0 lg:pt-7">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2">Monthly capacity{budget > 0 ? ` (${formatHours(budget)})` : ''}<span title="Logged: confirmed budget-counting client time this month. Planned: remaining estimates for open tasks in this plan, after subtracting their logged time this month. Other unscheduled work is not included." tabIndex={0} aria-label="Capacity calculation: logged client time plus remaining estimates for open tasks in this plan."><Info className="h-4 w-4 text-muted-foreground" /></span></span><span className={cn('font-medium', consumed > budget && budget > 0 && 'text-amber-500')}>{loggedHours === null ? 'Time unavailable' : budget <= 0 ? 'No budget set' : consumed > budget ? `${formatHours(consumed - budget)} over capacity` : `${formatHours(available)} available`}</span></div>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted sm:h-4" role="img" aria-label={`Monthly capacity: ${loggedHours === null ? 'unknown' : formatHours(loggedHours)} logged, ${formatHours(plannedHours)} planned, ${budget > 0 && loggedHours !== null ? formatHours(available) : 'unknown'} available`}>
                    {loggedHours !== null && <><span className="bg-sky-500 transition-[width]" style={{ width: `${loggedHours / scale * 100}%` }} /><span className="bg-sky-300 transition-[width]" style={{ width: `${plannedHours / scale * 100}%` }} /></>}
                </div>
                <div className="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" />{loggedHours === null ? '—' : formatHours(loggedHours)} logged</span><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-300" />{formatHours(plannedHours)} planned</span><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50" />{budget > 0 && loggedHours !== null ? formatHours(available) : '—'} available</span></div>
                <p className="mt-2 text-xs text-muted-foreground">Planned = remaining estimates in this plan.{summary.missingEstimates > 0 && ` ${summary.missingEstimates} tasks need estimates.`}</p>
            </section></header>
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg border border-border p-1" role="group" aria-label="Plan views">
                {([['month', 'This month'], ['full', 'Full plan'], ['results', 'Results']] as const).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => setView(key)} className={cn('min-h-10 rounded-md px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', view === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{label}</button>)}
            </div>
            <div className="flex items-center gap-1">
                <button className={secondary} aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft className="h-4 w-4" /></button>
                <label className="sr-only" htmlFor="execution-month">Execution month</label>
                <input id="execution-month" type="month" value={month} onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) onMonthChange(event.target.value); }} className={cn(field, 'w-auto')} />
                <button className={secondary} aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="flex flex-wrap gap-2"><button className={secondary} onClick={onAddExisting}>Add existing task</button><button className={primary} onClick={() => setScheduling(true)}><CalendarDays className="h-4 w-4" />Schedule work</button></div>
        </div>
        {view === 'full' ? fullPlan : view === 'results' ? <section className="space-y-4" aria-label="Monthly results">
            <h3 className="text-lg font-semibold">Delivered in {title}</h3><p className="text-sm text-muted-foreground">{summary.completed.length} of {summary.tasks.length} planned tasks completed. Completion reflects Tasks; estimated effort includes completed work.</p>
            {summary.completed.length ? <ul className="divide-y divide-border">{summary.completed.map(task => <li key={task.id}><button className="flex min-h-14 w-full items-center justify-between gap-4 py-3 text-left text-sm hover:text-primary" onClick={() => onOpenTask(task)}><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" />{task.title}</span><ArrowUpRight className="h-4 w-4 shrink-0" /></button></li>)}</ul> : <p className="py-8 text-sm text-muted-foreground">Completed tasks due this month will appear here.</p>}
            <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="h-4 w-4 shrink-0" />This is a delivery summary. Search performance and conversions are available in Search Insights.</p>
        </section> : <>
            {(summary.carryover.length > 0 || summary.unscheduled.length > 0) && <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><p>{summary.carryover.length > 0 && `${summary.carryover.length} unfinished from earlier months. `}{summary.unscheduled.length > 0 && `${summary.unscheduled.length} linked ${summary.unscheduled.length === 1 ? 'task has' : 'tasks have'} no due date.`}</p><button className="min-h-10 text-primary hover:underline" onClick={() => setScheduling(true)}>Review and schedule</button></div>}
            {summary.tasks.length === 0 ? <section className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center"><ListTodo className="mb-4 h-7 w-7 text-primary" /><h3 className="text-lg font-semibold">Choose this month’s focus</h3><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Pick a few items from your plan, assign an owner, and set a due date. Your full checklist stays in the backlog.</p><button className={cn(primary, 'mt-5')} onClick={() => setScheduling(true)}><Plus className="h-4 w-4" />Schedule your first task</button></section>
            : <div className="grid items-start gap-6 xl:grid-cols-[1.25fr_1fr]">
                <section aria-label="Monthly work" className="min-w-0">
                    <div className="grid grid-cols-[minmax(0,1fr)_90px_72px] gap-3 border-b border-border px-3 pb-3 text-[11px] uppercase tracking-wide text-muted-foreground 2xl:grid-cols-[minmax(0,1fr)_100px_85px_65px]"><span>Task</span><span>Status</span><span>Due</span><span className="hidden 2xl:block">Effort</span></div>
                    {summary.tasks.map(task => <button key={task.id} onClick={() => setSelectedId(task.id)} aria-pressed={selected?.id === task.id} className={cn('grid min-h-20 w-full grid-cols-[minmax(0,1fr)_90px_72px] items-center gap-3 border-b border-border border-l-[3px] px-3 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary 2xl:grid-cols-[minmax(0,1fr)_100px_85px_65px]', selected?.id === task.id ? 'rounded-lg border-l-primary bg-primary/10' : 'border-l-transparent hover:bg-muted/40')}>
                        <span className="min-w-0"><span className={cn('block text-sm font-medium', taskIsComplete(task) && 'text-muted-foreground')}>{task.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{task.assigneeIds?.length ? task.assigneeIds.map(id => members.find(member => member.userId === id)?.displayName ?? 'Team member').join(', ') : 'Unassigned'}</span></span><Status task={task} /><span className="text-xs text-muted-foreground">{shortDate(task.dueDate)}</span><span className="hidden text-xs text-muted-foreground 2xl:block">{task.estimatedHours == null ? '—' : formatHours(task.estimatedHours)}</span>
                    </button>)}
                    <p className="mt-4 text-xs leading-5 text-muted-foreground">Work is grouped by due month. Estimates include completed tasks and are separate from time logged.</p>
                </section>
                {selected && <TaskPane key={selected.id} task={selected} category={plan.steps.find(step => step.key === source?.stepKey)?.name} members={members} onSave={onSaveTask} onOpen={onOpenTask} />}
            </div>}
        </>}
        <ScheduleDialog open={scheduling} onClose={() => setScheduling(false)} month={month} plan={plan} members={members} remaining={budget - consumed} budget={budget} onSchedule={onSchedule} />
    </div>;
}

function TaskPane({ task, category, members, onSave, onOpen }: { task: Task; category?: string; members: MemberOption[]; onSave: ExecutionWorkspaceProps['onSaveTask']; onOpen: ExecutionWorkspaceProps['onOpenTask'] }) {
    const [ownerIds, setOwnerIds] = useState(task.assigneeIds ?? []);
    const [due, setDue] = useState(task.dueDate ?? '');
    const [effort, setEffort] = useState(task.estimatedHours?.toString() ?? '');
    const [status, setStatus] = useState(task.status);
    const [description, setDescription] = useState(task.description ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [dirty, setDirty] = useState(false);
    useEffect(() => { if (dirty) return; setOwnerIds(task.assigneeIds ?? []); setDue(task.dueDate ?? ''); setEffort(task.estimatedHours?.toString() ?? ''); setStatus(task.status); setDescription(task.description ?? ''); }, [task, dirty]);
    return <aside className="min-w-0 border-t border-border pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0" aria-label="Selected task details">
        <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="max-w-sm text-base font-semibold">{task.title}</h3><button className="flex min-h-8 items-center gap-1 text-xs text-primary hover:underline" onClick={() => onOpen(task)}>Open linked task<ArrowUpRight className="h-3.5 w-3.5" /></button></div>
        <form className="mt-3 space-y-3" onChange={() => { setSaved(false); setDirty(true); }} onSubmit={async event => {
            event.preventDefault(); setSaving(true); setError(''); setSaved(false);
            try { await onSave(task, { assigneeIds: ownerIds, dueDate: due, estimatedHours: effort !== '' ? Number(effort) : null, status, description }); setDirty(false); setSaved(true); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save task'); } finally { setSaving(false); }
        }}>
            <fieldset disabled={saving} className="space-y-3 disabled:opacity-60">
                <label className="block text-xs text-muted-foreground">Status<select className={cn(field, 'mt-1 max-w-48')} value={status} onChange={e => setStatus(e.target.value as Task['status'])}>{Object.entries(TASK_STATUS_LABELS).filter(([value]) => value !== 'done' && value !== 'approved' || value === task.status).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
                    <label className="text-xs text-muted-foreground">Owner<select className={cn(field, 'mt-1')} value={ownerIds.length > 1 ? '__multiple' : ownerIds[0] ?? ''} onChange={e => setOwnerIds(e.target.value ? [e.target.value] : [])}><option value="">Unassigned</option>{ownerIds.length > 1 && <option value="__multiple" disabled>{ownerIds.length} owners (keep)</option>}{ownerIds.filter(id => !members.some(member => member.userId === id)).map(id => <option key={id} value={id}>Existing member</option>)}{members.map(member => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}</select></label>
                    <label className="text-xs text-muted-foreground">Due date<input type="date" className={cn(field, 'mt-1')} required value={due} onChange={e => setDue(e.target.value)} /></label>
                    <label className="text-xs text-muted-foreground">Estimated hours<input type="number" className={cn(field, 'mt-1')} min="0" max="1000" step="0.25" placeholder="Not estimated" value={effort} onChange={e => setEffort(e.target.value)} /></label>
                </div>
                <div className="border-t border-border pt-4"><label className="text-sm font-medium" htmlFor="execution-description">Why this matters &amp; completion notes</label><textarea id="execution-description" className={cn(field, 'mt-2 min-h-20 leading-6')} value={description} onChange={e => setDescription(e.target.value)} placeholder="Explain the expected outcome and how you will verify the work." /></div>
                <p className="text-xs text-muted-foreground">Plan category<span className="mt-1 block text-sm text-foreground">{category ?? 'Custom work'}</span></p>
                <div className="flex flex-wrap gap-2"><button className={primary} type="submit">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save changes</button>{!taskIsComplete(task) && <button type="button" className={secondary} onClick={() => onOpen(task, true)}><CheckCircle2 className="h-4 w-4" />Review &amp; complete</button>}</div>
            </fieldset>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{saved && <p role="status" className="text-sm text-green-500">Changes saved to Tasks.</p>}
        </form>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Info className="h-4 w-4" />Shared with Tasks. Complete once, update everywhere.</p>
    </aside>;
}

function ScheduleDialog({ open, onClose, month, plan, members, remaining, budget, onSchedule }: { open: boolean; onClose: () => void; month: string; plan: MarketingPlan; members: MemberOption[]; remaining: number; budget: number; onSchedule: ExecutionWorkspaceProps['onSchedule'] }) {
    const [query, setQuery] = useState('');
    const [itemId, setItemId] = useState('');
    const [owner, setOwner] = useState('');
    const [due, setDue] = useState(`${month}-01`);
    const [effort, setEffort] = useState('1');
    const [busy, setBusy] = useState(false);
    const submitting = useRef(false);
    const [error, setError] = useState('');
    useEffect(() => { if (open) { setQuery(''); setItemId(''); setError(''); setOwner(''); setEffort('1'); const today = new Date(); const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`; setDue(day.startsWith(month) ? day : `${month}-01`); } }, [open, month]);
    const eligible = (plan.items ?? []).filter(item => item.status === 'todo' && (!item.linkedTask?.dueDate || item.linkedTask.dueDate.slice(0, 7) !== month));
    const options = eligible.filter(item => item.title.toLowerCase().includes(query.toLowerCase()));
    const picked = eligible.find(item => item.id === itemId);
    return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>Schedule work</DialogTitle><DialogDescription>Choose an open plan item and give it an owner, due date, and effort estimate. Existing linked tasks are reused.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={async event => { event.preventDefault(); if (!picked || submitting.current) return; submitting.current = true; setBusy(true); setError(''); try { await onSchedule(picked, { dueDate: due, assigneeId: owner, estimatedHours: Number(effort) }); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not schedule work'); } finally { submitting.current = false; setBusy(false); } }}>
            <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
                <label className="block text-sm">Find work<input className={cn(field, 'mt-1')} placeholder="Search your plan…" value={query} onChange={e => setQuery(e.target.value)} /></label>
                <div role="radiogroup" aria-label="Plan item" className="max-h-52 overflow-y-auto rounded-lg border border-border">{options.map(item => <label key={item.id} className={cn('flex cursor-pointer items-start gap-3 border-b border-border p-3 text-sm last:border-b-0 hover:bg-muted/50', itemId === item.id && 'bg-primary/10')}><input type="radio" className="mt-1 accent-primary" name="schedule-item" value={item.id} checked={itemId === item.id} onChange={() => { setItemId(item.id); setOwner(item.assigneeId ?? ''); setEffort(item.linkedTask?.estimatedHours?.toString() ?? '1'); }} /><span>{item.title}<span className="mt-1 block text-xs text-muted-foreground">{plan.steps.find(step => step.key === item.stepKey)?.name}{item.taskId ? ` · Linked task${item.dueDate ? ` · Due ${shortDate(item.dueDate)}` : ''}` : ''}</span></span></label>)}{!options.length && <p className="p-4 text-sm text-muted-foreground">{query ? 'No matching items. Try a different search.' : 'All open items are already planned for this month. Add new work in Full plan.'}</p>}</div>
                {picked && !options.some(item => item.id === picked.id) && <p className="text-sm">Selected: {picked.title}</p>}
                {picked?.linkedTask?.dueDate && <p className="text-sm text-amber-500">This moves the existing task from {shortDate(picked.linkedTask.dueDate)} to the new due date.</p>}
                <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Owner<select className={cn(field, 'mt-1')} required value={owner} onChange={e => setOwner(e.target.value)}><option value="">Select owner</option>{members.map(member => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}</select></label><label className="text-sm">Due date<input type="date" className={cn(field, 'mt-1')} min={`${month}-01`} max={`${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()}`} required value={due} onChange={e => setDue(e.target.value)} /></label><label className="text-sm">Estimated hours<input className={cn(field, 'mt-1')} type="number" min="0.25" max="1000" step="0.25" required value={effort} onChange={e => setEffort(e.target.value)} /></label></div>
                {budget > 0 && <p className={cn('text-sm', Number(effort) > remaining ? 'text-amber-500' : 'text-muted-foreground')}>{Number(effort) > remaining ? `This puts the plan ${formatHours(Number(effort) - remaining)} over budget. You can still schedule it.` : `${formatHours(remaining - Number(effort))} available after scheduling.`}</p>}
                <div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button><button type="submit" className={primary} disabled={!picked}>{busy ? 'Scheduling…' : 'Schedule task'}</button></div>
            </fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
    </DialogContent></Dialog>;
}
