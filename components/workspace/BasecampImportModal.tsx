'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X, ChevronDown, ChevronRight, CheckSquare, Square, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BasecampProject { id: number; name: string; }
interface BasecampTodolist { id: number; title: string; name: string; todos_count: number; }
interface BasecampTodoFull {
    id: number;
    title: string;
    due_on: string | null;
    completed: boolean;
    description: string;
    assignees: { name: string }[];
    app_url: string;
}

interface ListState {
    todolist: BasecampTodolist;
    expanded: boolean;
    loading: boolean;
    todos: BasecampTodoFull[];
    selectedTodoIds: Set<number>;
    listChecked: boolean;
}

type Step = 'project' | 'lists' | 'done';
type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface BasecampImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (importedCount: number) => void;
    clientId: string;
    organizationId: string;
    preselectedProjectId?: string;
}

export function BasecampImportModal({
    isOpen,
    onClose,
    onSuccess,
    clientId,
    organizationId,
    preselectedProjectId,
}: BasecampImportModalProps) {
    const router = useRouter();

    const [step, setStep] = useState<Step>('project');
    const [projects, setProjects] = useState<BasecampProject[]>([]);
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState(preselectedProjectId ?? '');

    const [listsLoading, setListsLoading] = useState(false);
    const [listStates, setListStates] = useState<ListState[]>([]);

    const [alreadyImported, setAlreadyImported] = useState<Set<number>>(new Set());

    const [priority, setPriority] = useState<Priority>('medium');
    const [importing, setImporting] = useState(false);
    const [importedCount, setImportedCount] = useState(0);
    const [importError, setImportError] = useState('');

    // Fetch already-imported basecamp_todo_ids for this client (for dedup display)
    const fetchAlreadyImported = useCallback(async () => {
        try {
            const res = await fetch(`/api/integrations/basecamp/imported-ids?clientId=${clientId}`);
            if (!res.ok) return;
            const data = await res.json() as { ids: number[] };
            setAlreadyImported(new Set(data.ids));
        } catch { /* non-critical */ }
    }, [clientId]);

    // Fetch projects on open
    useEffect(() => {
        if (!isOpen) return;
        setProjectsLoading(true);
        fetch('/api/integrations/basecamp/projects')
            .then(r => r.json())
            .then((data: { projects: BasecampProject[] }) => setProjects(data.projects ?? []))
            .catch(() => setProjects([]))
            .finally(() => setProjectsLoading(false));
        fetchAlreadyImported();
    }, [isOpen, fetchAlreadyImported]);

    // If a project is pre-selected, jump straight to lists
    useEffect(() => {
        if (!isOpen) return;
        if (preselectedProjectId) {
            setSelectedProjectId(preselectedProjectId);
            loadLists(preselectedProjectId);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, preselectedProjectId]);

    async function loadLists(projectId: string) {
        setListsLoading(true);
        setStep('lists');
        try {
            const res = await fetch(`/api/integrations/basecamp/todolists?projectId=${projectId}`);
            const data = await res.json() as { todolists: BasecampTodolist[] };
            setListStates((data.todolists ?? []).map(tl => ({
                todolist: tl,
                expanded: false,
                loading: false,
                todos: [],
                selectedTodoIds: new Set(),
                listChecked: false,
            })));
        } catch {
            setListStates([]);
        } finally {
            setListsLoading(false);
        }
    }

    function handleProjectContinue() {
        if (!selectedProjectId) return;
        loadLists(selectedProjectId);
    }

    async function toggleExpand(idx: number) {
        const ls = listStates[idx];
        if (!ls.expanded && ls.todos.length === 0) {
            // Lazy-load todos
            setListStates(prev => prev.map((s, i) => i === idx ? { ...s, loading: true } : s));
            try {
                const res = await fetch(
                    `/api/integrations/basecamp/todos?projectId=${selectedProjectId}&todolistId=${ls.todolist.id}&includeCompleted=true`,
                );
                const data = await res.json() as { todos: BasecampTodoFull[] };
                setListStates(prev => prev.map((s, i) =>
                    i === idx ? { ...s, todos: data.todos ?? [], loading: false, expanded: true } : s,
                ));
            } catch {
                setListStates(prev => prev.map((s, i) => i === idx ? { ...s, loading: false, expanded: true } : s));
            }
        } else {
            setListStates(prev => prev.map((s, i) => i === idx ? { ...s, expanded: !s.expanded } : s));
        }
    }

    function toggleTodo(listIdx: number, todoId: number) {
        setListStates(prev => prev.map((s, i) => {
            if (i !== listIdx) return s;
            const next = new Set(s.selectedTodoIds);
            if (next.has(todoId)) next.delete(todoId); else next.add(todoId);
            const activeTodos = s.todos.filter(t => !t.completed);
            const listChecked = activeTodos.length > 0 && activeTodos.every(t => next.has(t.id));
            return { ...s, selectedTodoIds: next, listChecked };
        }));
    }

    function toggleList(listIdx: number) {
        setListStates(prev => prev.map((s, i) => {
            if (i !== listIdx) return s;
            const activeTodos = s.todos.filter(t => !t.completed);
            const newChecked = !s.listChecked;
            const next = new Set<number>();
            if (newChecked) activeTodos.forEach(t => next.add(t.id));
            return { ...s, listChecked: newChecked, selectedTodoIds: next };
        }));
    }

    const totalSelected = listStates.reduce((acc, s) => {
        const activeTodoIds = new Set(s.todos.filter(t => !t.completed).map(t => t.id));
        return acc + [...s.selectedTodoIds].filter(id => activeTodoIds.has(id)).length;
    }, 0);

    async function handleImport() {
        if (totalSelected === 0) return;
        setImporting(true);
        setImportError('');

        const tasks: {
            title: string;
            description?: string;
            dueOn?: string;
            basecampTodoId: number;
            basecampProjectId: number;
            category?: string;
            priority: Priority;
        }[] = [];

        for (const ls of listStates) {
            const activeTodoIds = new Set(ls.todos.filter(t => !t.completed).map(t => t.id));
            for (const todo of ls.todos) {
                if (!ls.selectedTodoIds.has(todo.id) || !activeTodoIds.has(todo.id)) continue;
                tasks.push({
                    title: todo.title,
                    description: todo.description || undefined,
                    dueOn: todo.due_on || undefined,
                    basecampTodoId: todo.id,
                    basecampProjectId: Number(selectedProjectId),
                    category: ls.todolist.title || ls.todolist.name,
                    priority,
                });
            }
        }

        try {
            const res = await fetch('/api/integrations/basecamp/import-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, organizationId, tasks }),
            });
            const data = await res.json() as { imported: number; errors: string[] };
            if (!res.ok) throw new Error(data.errors?.[0] ?? 'Import failed');
            setImportedCount(data.imported);
            setStep('done');
            onSuccess(data.imported);
        } catch (err) {
            setImportError(err instanceof Error ? err.message : 'Import failed');
        } finally {
            setImporting(false);
        }
    }

    function handleReset() {
        setStep(preselectedProjectId ? 'lists' : 'project');
        setListStates([]);
        setImportedCount(0);
        setImportError('');
        if (preselectedProjectId) loadLists(preselectedProjectId);
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border border-border w-full max-w-2xl rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">🏕️</span>
                        <div>
                            <h2 className="text-base font-semibold">Import from Basecamp</h2>
                            <p className="text-xs text-muted-foreground">
                                {step === 'project' && 'Select a Basecamp project'}
                                {step === 'lists' && 'Choose tasks to import'}
                                {step === 'done' && 'Import complete'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 p-4">

                    {/* STEP: project */}
                    {step === 'project' && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Choose the Basecamp project linked to this client. You&apos;ll then pick which to-do lists and tasks to bring in.
                            </p>
                            {projectsLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Loading projects…
                                </div>
                            ) : (
                                <select
                                    value={selectedProjectId}
                                    onChange={e => setSelectedProjectId(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                >
                                    <option value="">Select a project…</option>
                                    {projects.map(p => (
                                        <option key={p.id} value={String(p.id)}>{p.name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    )}

                    {/* STEP: lists */}
                    {step === 'lists' && (
                        <div className="space-y-2">
                            {listsLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Loading to-do lists…
                                </div>
                            ) : listStates.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-6">No to-do lists found in this project.</p>
                            ) : (
                                listStates.map((ls, listIdx) => {
                                    const activeTodos = ls.todos.filter(t => !t.completed);
                                    const completedCount = ls.todos.length - activeTodos.length;
                                    const anySelected = ls.selectedTodoIds.size > 0;

                                    return (
                                        <div key={ls.todolist.id} className="border border-border rounded-lg overflow-hidden">
                                            {/* List header */}
                                            <div className="flex items-center gap-2 p-3 bg-muted/20 hover:bg-muted/30 transition-colors">
                                                <button
                                                    type="button"
                                                    onClick={() => ls.todos.length > 0 ? toggleList(listIdx) : undefined}
                                                    className={cn(
                                                        'flex-shrink-0 text-muted-foreground transition-colors',
                                                        ls.todos.length > 0 ? 'hover:text-primary cursor-pointer' : 'opacity-40 cursor-default',
                                                    )}
                                                    title={ls.todos.length === 0 ? 'Expand list to select tasks' : undefined}
                                                >
                                                    {ls.listChecked
                                                        ? <CheckSquare className="h-4 w-4 text-primary" />
                                                        : anySelected
                                                        ? <CheckSquare className="h-4 w-4 text-primary/50" />
                                                        : <Square className="h-4 w-4" />
                                                    }
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => toggleExpand(listIdx)}
                                                    className="flex-1 flex items-center gap-2 text-left"
                                                >
                                                    <span className="text-sm font-medium">{ls.todolist.title || ls.todolist.name}</span>
                                                    {anySelected && (
                                                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                                            {ls.selectedTodoIds.size} selected
                                                        </span>
                                                    )}
                                                    <span className="text-xs text-muted-foreground ml-auto">
                                                        {ls.todos.length > 0
                                                            ? `${activeTodos.length} task${activeTodos.length !== 1 ? 's' : ''}`
                                                            : `${ls.todolist.todos_count} task${ls.todolist.todos_count !== 1 ? 's' : ''}`
                                                        }
                                                    </span>
                                                    <span className="text-muted-foreground">
                                                        {ls.loading
                                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                            : ls.expanded
                                                            ? <ChevronDown className="h-3.5 w-3.5" />
                                                            : <ChevronRight className="h-3.5 w-3.5" />
                                                        }
                                                    </span>
                                                </button>
                                            </div>

                                            {/* Tasks */}
                                            {ls.expanded && (
                                                <div className="divide-y divide-border/50">
                                                    {activeTodos.length === 0 && completedCount === 0 && (
                                                        <p className="text-xs text-muted-foreground px-4 py-3">No tasks in this list.</p>
                                                    )}

                                                    {/* Select all row */}
                                                    {activeTodos.length > 0 && (
                                                        <div className="flex items-center gap-2 px-4 py-2 bg-muted/10">
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleList(listIdx)}
                                                                className="text-xs text-primary hover:underline font-medium"
                                                            >
                                                                {ls.listChecked ? 'Deselect all' : 'Select all'}
                                                            </button>
                                                            <span className="text-xs text-muted-foreground">
                                                                ({activeTodos.length} active task{activeTodos.length !== 1 ? 's' : ''})
                                                            </span>
                                                            {completedCount > 0 && (
                                                                <span className="text-xs text-muted-foreground ml-auto">
                                                                    {completedCount} already completed (hidden)
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}

                                                    {activeTodos.map(todo => {
                                                        const isAlreadyImported = alreadyImported.has(todo.id);
                                                        const isSelected = ls.selectedTodoIds.has(todo.id);
                                                        return (
                                                            <div
                                                                key={todo.id}
                                                                className={cn(
                                                                    'flex items-start gap-3 px-4 py-2.5',
                                                                    isAlreadyImported ? 'opacity-50' : 'hover:bg-muted/10 cursor-pointer',
                                                                )}
                                                                onClick={() => !isAlreadyImported && toggleTodo(listIdx, todo.id)}
                                                            >
                                                                <div className="flex-shrink-0 mt-0.5">
                                                                    {isAlreadyImported ? (
                                                                        <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                                                                    ) : isSelected ? (
                                                                        <CheckSquare className="h-4 w-4 text-primary" />
                                                                    ) : (
                                                                        <Square className="h-4 w-4 text-muted-foreground" />
                                                                    )}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className={cn('text-sm', isAlreadyImported && 'line-through text-muted-foreground')}>
                                                                        {todo.title}
                                                                    </p>
                                                                    <div className="flex items-center gap-3 mt-0.5">
                                                                        {isAlreadyImported && (
                                                                            <span className="text-xs text-muted-foreground">Already imported</span>
                                                                        )}
                                                                        {todo.due_on && !isAlreadyImported && (
                                                                            <span className="text-xs text-muted-foreground">Due {todo.due_on}</span>
                                                                        )}
                                                                        {todo.assignees.length > 0 && (
                                                                            <span className="text-xs text-muted-foreground">
                                                                                {todo.assignees.map(a => a.name).join(', ')}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}

                    {/* STEP: done */}
                    {step === 'done' && (
                        <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
                            <CheckCircle2 className="h-12 w-12 text-green-500" />
                            <div>
                                <p className="text-lg font-semibold">
                                    {importedCount} task{importedCount !== 1 ? 's' : ''} imported
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Tasks are now in the client&apos;s task list, linked to Basecamp.
                                </p>
                            </div>
                            <div className="flex gap-3 mt-2">
                                <button
                                    type="button"
                                    onClick={() => { onClose(); router.push(`/workspace/${clientId}?tab=tasks`); }}
                                    className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                                >
                                    View Tasks
                                </button>
                                <button
                                    type="button"
                                    onClick={handleReset}
                                    className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted/30 transition-colors"
                                >
                                    Import More
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                {step !== 'done' && (
                    <div className="flex-shrink-0 border-t border-border p-4 flex items-center justify-between bg-muted/10">
                        <div>
                            {step === 'lists' && totalSelected > 0 && (
                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-muted-foreground">
                                        <span className="font-semibold text-foreground">{totalSelected}</span> task{totalSelected !== 1 ? 's' : ''} selected
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-muted-foreground font-medium">Priority:</label>
                                        <select
                                            value={priority}
                                            onChange={e => setPriority(e.target.value as Priority)}
                                            className="text-xs px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                        >
                                            <option value="low">Low</option>
                                            <option value="medium">Medium</option>
                                            <option value="high">High</option>
                                            <option value="urgent">Urgent</option>
                                        </select>
                                    </div>
                                </div>
                            )}
                            {importError && (
                                <div className="flex items-center gap-1.5 text-sm text-destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    {importError}
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Cancel
                            </button>
                            {step === 'project' && (
                                <button
                                    type="button"
                                    onClick={handleProjectContinue}
                                    disabled={!selectedProjectId || projectsLoading}
                                    className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                >
                                    Continue
                                </button>
                            )}
                            {step === 'lists' && (
                                <button
                                    type="button"
                                    onClick={handleImport}
                                    disabled={totalSelected === 0 || importing}
                                    className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                                >
                                    {importing ? (
                                        <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</>
                                    ) : (
                                        `Import ${totalSelected > 0 ? totalSelected : ''} Task${totalSelected !== 1 ? 's' : ''}`
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
