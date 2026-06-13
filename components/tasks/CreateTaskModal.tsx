'use client';

import { useState, useEffect } from 'react';
import { X, Plus, LayoutTemplate, UserCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task, TaskPriority, TaskStatus, TaskCategory, TaskTemplate } from '@/lib/types';
import { createTaskFromTemplate, createTask } from '@/lib/supabase/tasks';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { RecurrenceSelector } from './RecurrenceSelector';
import { useOrganization } from '@/components/providers/organization-provider';
import { createClient } from '@/lib/supabase/client';

interface CreateTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (task: Task) => void;
    organizationId: string;
    currentUserId?: string;
    /** Pre-fill these when opened from a client context */
    defaultClientId?: string;
    defaultClientName?: string;
    defaultProjectId?: string;
    /** Pre-fill due date (e.g., when clicking a calendar cell) */
    defaultDueDate?: string;
    /** Pre-fill all fields from a template */
    templatePrefill?: TaskTemplate;
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
];

const CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
    { value: 'content', label: 'Content' },
    { value: 'technical', label: 'Technical SEO' },
    { value: 'local', label: 'Local SEO' },
    { value: 'links', label: 'Link Building' },
    { value: 'reporting', label: 'Reporting' },
    { value: 'admin', label: 'Admin' },
];

export function CreateTaskModal({
    isOpen,
    onClose,
    onCreated,
    organizationId,
    currentUserId,
    defaultClientId,
    defaultClientName,
    defaultProjectId,
    defaultDueDate,
    templatePrefill,
}: CreateTaskModalProps) {
    const { organization } = useOrganization();

    const [orgMembers, setOrgMembers] = useState<{ id: string; name: string }[]>([]);
    const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

    // Fetch org members once per modal session
    useEffect(() => {
        if (!isOpen || !organizationId || orgMembers.length > 0) return;
        getOrganizationMembers(organizationId).then(members => {
            setOrgMembers(members.map(m => ({
                id: m.userId,
                name: (m.user as any)?.fullName || (m.user as any)?.email || 'Team member',
            })));
        }).catch(() => {});
    }, [isOpen, organizationId]);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [category, setCategory] = useState<TaskCategory | ''>('');
    const [dueDate, setDueDate] = useState(defaultDueDate ?? '');
    const [recurrence, setRecurrence] = useState<Task['recurrence']>(undefined);
    const [status] = useState<TaskStatus>('todo');
    const [syncToBasecamp, setSyncToBasecamp] = useState(false);
    const [clientHasBasecamp, setClientHasBasecamp] = useState(false);
    const [bcProjectId, setBcProjectId] = useState('');
    const [bcDefaultTodolistId, setBcDefaultTodolistId] = useState('');
    const [bcTodolistId, setBcTodolistId] = useState('');
    const [bcTodolists, setBcTodolists] = useState<{ id: number; title: string; name: string }[]>([]);
    const [bcLoadingLists, setBcLoadingLists] = useState(false);

    // Sync fields when modal opens or template/date changes
    useEffect(() => {
        if (isOpen) {
            setDueDate(defaultDueDate ?? '');
            setAssigneeIds([]);
            if (templatePrefill) {
                setTitle(templatePrefill.name);
                setDescription(templatePrefill.description ?? '');
                setPriority(templatePrefill.priority ?? 'medium');
                setCategory(templatePrefill.category ?? '');
                setRecurrence(templatePrefill.recurrence);
            } else {
                setTitle('');
                setDescription('');
                setPriority('medium');
                setCategory('');
                setRecurrence(undefined);
            }
        }
    }, [isOpen, defaultDueDate, templatePrefill]);

    // Check if the selected client has Basecamp sync enabled (project required, todolist optional)
    useEffect(() => {
        if (!defaultClientId) {
            setClientHasBasecamp(false);
            setSyncToBasecamp(false);
            setBcProjectId('');
            setBcDefaultTodolistId('');
            setBcTodolistId('');
            setBcTodolists([]);
            return;
        }
        const supabase = createClient();
        if (!supabase) return;
        supabase
            .from('clients')
            .select('custom_fields')
            .eq('id', defaultClientId)
            .single()
            .then(({ data }: { data: any }) => {
                const cf = (data?.custom_fields as Record<string, unknown>) ?? {};
                const enabled = !!(cf.basecamp_sync_enabled && cf.basecamp_project_id);
                setClientHasBasecamp(enabled);
                if (enabled) {
                    const projectId = String(cf.basecamp_project_id ?? '');
                    const defaultListId = String(cf.basecamp_todolist_id ?? '');
                    setBcProjectId(projectId);
                    setBcDefaultTodolistId(defaultListId);
                    setBcTodolistId(defaultListId);
                } else {
                    setSyncToBasecamp(false);
                    setBcProjectId('');
                    setBcDefaultTodolistId('');
                    setBcTodolistId('');
                    setBcTodolists([]);
                }
            })
            .catch(() => {
                setClientHasBasecamp(false);
                setSyncToBasecamp(false);
            });
    }, [defaultClientId]);

    function handleSyncToggle() {
        const next = !syncToBasecamp;
        setSyncToBasecamp(next);
        if (next && bcProjectId && bcTodolists.length === 0 && !bcLoadingLists) {
            setBcLoadingLists(true);
            fetch(`/api/integrations/basecamp/todolists?projectId=${bcProjectId}`)
                .then(r => r.json())
                .then(d => { if (d.todolists) setBcTodolists(d.todolists); })
                .catch(() => {})
                .finally(() => setBcLoadingLists(false));
        }
    }

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) { setError('Title is required'); return; }
        if (!organizationId) { setError('Organization not found'); return; }
        setSaving(true);
        setError('');

        const overrides = {
            organizationId,
            projectId: defaultProjectId,
            clientId: defaultClientId,
            title: title.trim(),
            description: description.trim() || undefined,
            priority,
            status,
            category: category as TaskCategory || undefined,
            dueDate: dueDate || undefined,
            createdBy: currentUserId,
            actorName: orgMembers.find(m => m.id === currentUserId)?.name,
            assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
            recurrence: recurrence || undefined,
            syncToBasecamp: clientHasBasecamp ? syncToBasecamp : false,
            basecampTodolistId: (clientHasBasecamp && syncToBasecamp && bcTodolistId) ? bcTodolistId : undefined,
        };

        const result = templatePrefill
            ? await createTaskFromTemplate(templatePrefill.id, overrides)
            : await createTask(overrides);

        setSaving(false);
        if (result.success && result.data) {
            onCreated({ ...result.data, clientName: defaultClientName ?? result.data.clientName });
            onClose();
        } else {
            setError(result.error ?? 'Failed to create task');
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 z-[130] bg-background/80 backdrop-blur-sm" onClick={onClose} />
            <div className="fixed z-[140] inset-0 flex items-center justify-center p-4">
                <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <h3 className="font-bold text-foreground flex items-center gap-2">
                            <Plus className="h-4 w-4" /> New Task
                        </h3>
                        <div className="flex items-center gap-2">
                            {templatePrefill && (
                                <span className="flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-1 rounded-full">
                                    <LayoutTemplate className="h-3 w-3" />
                                    {templatePrefill.name}
                                </span>
                            )}
                            {defaultClientName && (
                                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">{defaultClientName}</span>
                            )}
                        </div>
                        <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="p-5 space-y-4">
                        {/* Title */}
                        <div>
                            <input
                                autoFocus
                                type="text"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder="Task title…"
                                className="w-full text-base font-semibold bg-transparent border-none p-0 focus:ring-0 placeholder:text-muted-foreground/50"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Description (optional)…"
                                rows={3}
                                className="w-full text-sm bg-muted/30 border border-border rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder:text-muted-foreground/50"
                            />
                        </div>

                        {/* Priority + Category row */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Priority</label>
                                <select
                                    value={priority}
                                    onChange={e => setPriority(e.target.value as TaskPriority)}
                                    className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Category</label>
                                <select
                                    value={category}
                                    onChange={e => setCategory(e.target.value as TaskCategory)}
                                    className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="">None</option>
                                    {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Assignee */}
                        {orgMembers.length > 0 && (
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <UserCircle2 className="h-3 w-3" /> Assign To
                                </label>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {orgMembers.map(m => {
                                        const selected = assigneeIds.includes(m.id);
                                        return (
                                            <button
                                                key={m.id}
                                                type="button"
                                                onClick={() => setAssigneeIds(prev =>
                                                    selected ? prev.filter(id => id !== m.id) : [...prev, m.id]
                                                )}
                                                className={cn(
                                                    'px-2.5 py-1 rounded-full text-xs border transition-all',
                                                    selected
                                                        ? 'bg-primary text-primary-foreground border-primary font-medium'
                                                        : 'bg-muted/30 text-muted-foreground border-border hover:border-primary/40 hover:text-foreground',
                                                )}
                                            >
                                                {m.name.split(' ')[0]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Due Date */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due Date</label>
                            <input
                                type="date"
                                value={dueDate}
                                onChange={e => setDueDate(e.target.value)}
                                className="w-full mt-1 bg-muted/30 border border-border rounded-lg p-2 text-sm focus:ring-1 focus:ring-primary"
                            />
                        </div>

                        {/* Recurrence */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Recurrence</label>
                            <RecurrenceSelector value={recurrence} onChange={setRecurrence} />
                        </div>

                        {/* Basecamp sync — only shown when client has Basecamp enabled */}
                        {clientHasBasecamp && (
                            <div className={cn(
                                'border border-border rounded-lg overflow-hidden',
                                syncToBasecamp ? 'border-green-500/30' : '',
                            )}>
                                {/* Toggle row */}
                                <div className="flex items-center justify-between py-2 px-3 bg-muted/30">
                                    <div className="flex items-center gap-2">
                                        <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <circle cx="16" cy="16" r="16" fill="#1D2D35"/>
                                            <path d="M16 8C11.582 8 8 11.582 8 16c0 2.21.895 4.21 2.344 5.656L16 28l5.656-6.344A7.953 7.953 0 0024 16c0-4.418-3.582-8-8-8z" fill="#53C68C"/>
                                        </svg>
                                        <span className="text-sm font-medium text-foreground">Sync to Basecamp</span>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={syncToBasecamp}
                                        onClick={handleSyncToggle}
                                        className={cn(
                                            'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                                            syncToBasecamp ? 'bg-green-500' : 'bg-muted',
                                        )}
                                    >
                                        <span className={cn(
                                            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                                            syncToBasecamp ? 'translate-x-4' : 'translate-x-0',
                                        )} />
                                    </button>
                                </div>
                                {/* Todolist picker — shown when sync is ON */}
                                {syncToBasecamp && (
                                    <div className="px-3 py-2.5 border-t border-border/50 bg-muted/10">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Todolist</label>
                                        {bcLoadingLists ? (
                                            <p className="text-xs text-muted-foreground mt-1">Loading todolists…</p>
                                        ) : (
                                            <select
                                                value={bcTodolistId}
                                                onChange={e => setBcTodolistId(e.target.value)}
                                                className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                            >
                                                <option value="">Select a todolist…</option>
                                                {bcTodolists.map(t => (
                                                    <option key={t.id} value={String(t.id)}>
                                                        {t.title || t.name}{String(t.id) === bcDefaultTodolistId ? ' (default)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {error && <p className="text-xs text-red-500">{error}</p>}

                        {/* Actions */}
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!title.trim() || saving}
                                className="px-4 py-2 text-sm font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                                {saving ? 'Creating…' : 'Create Task'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
}
