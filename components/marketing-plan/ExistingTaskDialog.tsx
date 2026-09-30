'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getTasksByClient } from '@/lib/supabase/tasks';
import { taskIsComplete } from '@/lib/marketing-plan-execution';
import type { MarketingPlan, Task } from '@/lib/types';

const field = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';

export function ExistingTaskDialog({ open, plan, month, onClose, onAttach }: {
    open: boolean; plan: MarketingPlan; month: string; onClose: () => void;
    onAttach: (task: Task, step: string, due: string) => Promise<void>;
}) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [taskId, setTaskId] = useState('');
    const [step, setStep] = useState(plan.steps[0]?.key ?? '');
    const [due, setDue] = useState(`${month}-01`);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true); setError(''); setTaskId(''); setQuery('');
        getTasksByClient(plan.clientId, true).then(rows => { if (!cancelled) { setTasks(rows); setLoading(false); } }).catch(() => { if (!cancelled) { setLoading(false); setError('Could not load client tasks. Close and retry.'); } });
        return () => { cancelled = true; };
    }, [open, plan.clientId]);
    const linkedIds = new Set(plan.items?.map(item => item.taskId));
    const options = tasks.filter(task => !taskIsComplete(task) && !linkedIds.has(task.id) && !task.parentTaskId && task.title.toLowerCase().includes(query.toLowerCase()));
    const selected = tasks.find(task => task.id === taskId);
    return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent showCloseButton={!busy} className="max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>Add existing client task</DialogTitle><DialogDescription>Choose client work, including tasks imported from Basecamp. This links the original task to your plan.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={async event => {
            event.preventDefault(); if (!selected || busy) return;
            setBusy(true); setError('');
            try { await onAttach(selected, step, due); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not add task'); } finally { setBusy(false); }
        }}><fieldset disabled={busy} className="space-y-4">
            <label className="block text-sm">Find client task<input className={field} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks…" /></label>
            <label className="block text-sm">Task<select className={field} required value={taskId} onChange={e => { setTaskId(e.target.value); const task = tasks.find(t => t.id === e.target.value); setDue(task?.dueDate ?? `${month}-01`); }}><option value="">Choose a task</option>{options.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
            {loading ? <p className="text-sm text-muted-foreground">Loading client tasks…</p> : !options.length && <p className="text-sm text-muted-foreground">No matching open, unlinked tasks. Import work from Basecamp in All client tasks.</p>}
            <label className="block text-sm">Plan category<select className={field} required value={step} onChange={e => setStep(e.target.value)}>{plan.steps.map(category => <option key={category.key} value={category.key}>{category.name}</option>)}</select></label>
            <label className="block text-sm">Due date<input className={field} type="date" required value={due} onChange={e => setDue(e.target.value)} /></label>
            {selected && <p className="text-xs text-muted-foreground">The task keeps its existing owner and estimate. Changing its due date also updates Tasks and Basecamp through the existing sync.</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button><button type="submit" disabled={!selected || busy || loading} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Adding…' : 'Add to plan'}</button></div>
        </fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</form>
    </DialogContent></Dialog>;
}
