'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StagePlanList } from '@/components/seo-plan/StagePlanList';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { TaskListView } from '@/components/tasks/TaskListView';
import {
    CATEGORY_LABEL, INITIATIVE_CATEGORIES, INITIATIVE_STATES, formatInitiativeDay, orderedInitiatives,
    type CampaignInitiative, type InitiativeState,
} from '@/lib/campaign-workspace/initiatives';
import { buildProjectDraft, filterProjectTasks, PROJECT_STATUS, projectProgress } from '@/lib/projects/project-cards';
import { projectsHref } from '@/lib/projects/project-links';
import {
    listCampaignInitiatives, saveCampaignInitiative, updateCampaignInitiativeStatus,
} from '@/lib/supabase/campaign-initiatives';
import { createTask, getTasksByClient } from '@/lib/supabase/tasks';
import type { Task } from '@/lib/types';

const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

function Progress({ done, total }: { done: number; total: number }) {
    return (
        <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">{done} of {total} tasks done</p>
            <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: total ? `${done / total * 100}%` : '0%' }} />
            </div>
        </div>
    );
}

function NewProjectForm({ clientId, organizationId, onSaved }: {
    clientId: string;
    organizationId: string;
    onSaved: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const fields = new FormData(event.currentTarget);
        let draft;
        try {
            draft = buildProjectDraft(String(fields.get('name') ?? ''), String(fields.get('category') ?? ''));
        } catch (error) {
            setError((error as Error).message);
            return;
        }
        setBusy(true);
        setError('');
        try {
            await saveCampaignInitiative({ clientId, assertedOrganizationId: organizationId, draft });
            onSaved();
        } catch {
            setError('Could not create the project. Try again.');
        } finally {
            setBusy(false);
        }
    }
    return (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-sm font-medium">
                    Name
                    <Input name="name" required maxLength={160} />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                    Category
                    <select name="category" required defaultValue="" className={selectClass}>
                        <option value="" disabled>Choose a category</option>
                        {INITIATIVE_CATEGORIES.map(category => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}
                    </select>
                </label>
                <Button type="submit">{busy ? 'Creating…' : 'Create project'}</Button>
                <Button asChild variant="ghost"><Link href={projectsHref(clientId)}>Cancel</Link></Button>
            </fieldset>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
    );
}

function ProjectStatus({ project }: { project: CampaignInitiative }) {
    const [state, setState] = useState(project.state);
    const [verified, setVerified] = useState(Boolean(project.evidenceUrl && project.verifiedOn));
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function save(next: InitiativeState, verification?: { evidenceUrl: string; verifiedOn: string }) {
        setBusy(true);
        setError('');
        try {
            await updateCampaignInitiativeStatus({
                clientId: project.clientId, assertedOrganizationId: project.organizationId,
                initiativeId: project.id, state: next, verification,
            });
            setState(next);
            if (verification) setVerified(true);
            setConfirming(false);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not update the project status.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-2">
            <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
                Status
                <select value={confirming ? 'completed_verified' : state} className={selectClass} disabled={busy} onChange={event => {
                    const next = event.target.value as InitiativeState;
                    setError('');
                    if (next === 'completed_verified' && !verified) setConfirming(true);
                    else {
                        setConfirming(false);
                        if (next !== state) void save(next);
                    }
                }}>
                    {INITIATIVE_STATES.map(value => <option key={value} value={value}>{PROJECT_STATUS[value].label}</option>)}
                </select>
            </label>
            {confirming && (
                <form onSubmit={event => {
                    event.preventDefault();
                    if (busy) return;
                    const fields = new FormData(event.currentTarget);
                    void save('completed_verified', {
                        evidenceUrl: String(fields.get('evidenceUrl')), verifiedOn: String(fields.get('verifiedOn')),
                    });
                }}>
                    <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
                        <label className="grid gap-1 text-sm">
                            Evidence URL
                            <Input name="evidenceUrl" type="url" required maxLength={500} defaultValue={project.evidenceUrl ?? ''} />
                        </label>
                        <label className="grid gap-1 text-sm">
                            Verification date
                            <Input name="verifiedOn" type="date" required defaultValue={project.verifiedOn ?? ''} />
                        </label>
                        <Button type="submit">Save status</Button>
                        <Button type="button" variant="ghost" onClick={() => { setConfirming(false); setError(''); }}>Cancel</Button>
                    </fieldset>
                </form>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
    );
}

function ProjectDetail({ project, clientName, tasks, stageListOn, userId, reload }: {
    project: CampaignInitiative;
    clientName: string;
    tasks: Task[];
    stageListOn: boolean;
    userId?: string;
    reload: () => void;
}) {
    const [boardProgress, setBoardProgress] = useState<{ done: number; total: number } | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const projectTasks = filterProjectTasks(project.id, tasks);
    const selected = projectTasks.find(task => task.id === selectedId) ?? null;

    async function addTask(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const form = event.currentTarget;
        const title = String(new FormData(form).get('title') ?? '').trim();
        if (!title) return;
        setBusy(true);
        setError('');
        try {
            const result = await createTask({
                clientId: project.clientId, organizationId: project.organizationId,
                initiativeId: project.id, title, createdBy: userId,
            });
            if (!result.success) throw new Error('Could not add the task.');
            form.reset();
            reload();
        } catch {
            setError('Could not add the task. Try again.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="space-y-5">
            <Link href={projectsHref(project.clientId)} className="text-sm font-medium text-primary hover:underline">← Back to Projects</Link>
            <header className="space-y-3">
                <h2 className="text-xl font-semibold">{project.title}</h2>
                <p className="text-sm text-muted-foreground">{project.category ? CATEGORY_LABEL[project.category] : 'No category'}</p>
                <ProjectStatus project={project} />
                <div className="max-w-xs">
                    <Progress {...(stageListOn && boardProgress ? boardProgress : projectProgress(project.id, tasks))} />
                </div>
            </header>
            {stageListOn ? (
                <StagePlanList
                    clientId={project.clientId}
                    clientName={clientName}
                    project={{ id: project.id, title: project.title }}
                    onProjectProgress={setBoardProgress}
                />
            ) : (
                <div className="space-y-3">
                    <form onSubmit={addTask} className="flex max-w-lg gap-2">
                        <Input name="title" aria-label="Task name" placeholder="Task name" required maxLength={240} disabled={busy} />
                        <Button type="submit" disabled={busy}>Add task</Button>
                    </form>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                    <TaskListView tasks={projectTasks} onTaskClick={task => setSelectedId(task.id)} onTaskUpdated={reload} />
                    {selected && (
                        <TaskDetailModal task={selected} isOpen onClose={() => setSelectedId(null)} onUpdate={reload} onDelete={reload} currentUserId={userId} />
                    )}
                </div>
            )}
        </section>
    );
}

export function WorkspaceProjects({ clientId, clientName, organizationId, projectId, create, stageListOn, userId, onCreated }: {
    clientId: string;
    clientName: string;
    organizationId: string;
    projectId: string | null;
    create: boolean;
    stageListOn: boolean;
    userId?: string;
    onCreated: () => void;
}) {
    const [projects, setProjects] = useState<CampaignInitiative[] | null>(null);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const reload = () => setReloadKey(key => key + 1);

    useEffect(() => {
        let active = true;
        void Promise.all([listCampaignInitiatives(clientId), getTasksByClient(clientId, true)])
            .then(([result, rows]) => {
                if (!active) return;
                if (result.unavailable) throw new Error('Projects unavailable');
                setProjects(orderedInitiatives(result.initiatives.filter(project => project.organizationId === organizationId)));
                setTasks(rows.filter(task => task.organizationId === organizationId));
                setError(false);
            })
            .catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, [clientId, organizationId, reloadKey]);

    if (error) return <p role="alert" className="text-sm text-destructive">Could not load projects. <button type="button" className="underline" onClick={reload}>Try again</button></p>;
    if (!projects) return <p role="status" className="text-sm text-muted-foreground">Loading projects…</p>;

    if (projectId !== null) {
        const project = projects.find(project => project.id === projectId);
        return project ? (
            <ProjectDetail key={project.id} project={project} clientName={clientName} tasks={tasks} stageListOn={stageListOn} userId={userId} reload={reload} />
        ) : (
            <div className="space-y-2">
                <p>This project couldn&apos;t be found</p>
                <Link href={projectsHref(clientId)} className="text-sm font-medium text-primary hover:underline">Back to Projects</Link>
            </div>
        );
    }

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Projects</h2>
                {projects.length > 0 && !create && (
                    <Button asChild><Link href={projectsHref(clientId, { create: true })}>New project</Link></Button>
                )}
            </div>
            {create && <NewProjectForm clientId={clientId} organizationId={organizationId} onSaved={() => { reload(); onCreated(); }} />}
            {projects.length === 0 && !create && (
                <div className="space-y-3 rounded-xl border border-border bg-card p-6 text-center">
                    <p className="text-sm text-muted-foreground">No projects yet</p>
                    <Button asChild><Link href={projectsHref(clientId, { create: true })}>Create your first project</Link></Button>
                </div>
            )}
            {projects.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {projects.map(project => {
                        const progress = projectProgress(project.id, tasks);
                        const status = PROJECT_STATUS[project.state];
                        return (
                            <Link key={project.id} href={projectsHref(clientId, { projectId: project.id })}
                                className="space-y-3 rounded-xl border border-border bg-card p-4 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <h3 className="min-w-0 break-words font-semibold">{project.title}</h3>
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span>
                                </div>
                                <p className="text-sm text-muted-foreground">{project.category ? CATEGORY_LABEL[project.category] : 'No category'}</p>
                                <Progress {...progress} />
                                {progress.nextDue && <p className="text-sm text-muted-foreground">Next due {formatInitiativeDay(progress.nextDue)}</p>}
                                {project.ownerName && <p className="text-sm text-muted-foreground">Owner: {project.ownerName}</p>}
                            </Link>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
