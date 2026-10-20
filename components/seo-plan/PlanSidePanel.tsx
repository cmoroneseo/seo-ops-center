'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { StageListTask } from '@/lib/seo-plan/stage-list';
import { normalizeBlockedReason } from '@/lib/tasks/status';
import {
    PLAN_LABELS,
    PLAN_PANEL_STATUSES,
    PLAN_PANEL_STATUS_LABEL,
    PLAN_TEXT_AUTOSAVE_MS,
    formatPlanCreated,
    formatPlanEstimateInput,
    formatPlanHours,
    parsePlanEstimate,
    planBasecampLine,
    planDeleteCopy,
    planDescriptionSave,
    planLabelText,
    planLiveUrlSave,
    planOnboardingStage,
    planPanelDue,
    planParentField,
    planTitleSave,
    readPlanLabels,
    togglePlanValue,
    writePlanLabels,
    type PlanPanelField,
    type PlanPanelPerson,
    type PlanPanelSave,
    type PlanPanelStatus,
    type PlanPanelTask,
} from '@/lib/seo-plan/plan-panel';
import { cn } from '@/lib/utils';

/**
 * Non-modal task panel for the SEO Plan.
 * Fields save themselves. The list beside it stays usable.
 * Blocked is a label on tasks.blocked_reason. Adding it asks for one line.
 */
export function PlanSidePanel({
    task,
    tasks,
    people,
    clientName,
    today,
    now,
    focusField,
    autosaveMs = PLAN_TEXT_AUTOSAVE_MS,
    onSave,
    onDuplicate,
    onDelete,
    onClose,
}: {
    task: PlanPanelTask;
    tasks: readonly StageListTask[];
    people: readonly PlanPanelPerson[];
    clientName: string;
    today: string;
    now?: Date;
    focusField: PlanPanelField | null;
    autosaveMs?: number;
    onSave: (taskId: string, save: PlanPanelSave) => Promise<string | null>;
    onDuplicate: () => Promise<string | null>;
    onDelete: () => Promise<string | null>;
    onClose: () => void;
}) {
    const rootRef = useRef<HTMLElement>(null);
    const saveRef = useRef(onSave);
    saveRef.current = onSave;
    const [pending, setPending] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description);
    const [estimate, setEstimate] = useState(formatPlanEstimateInput(task.estimatedHours));
    const [liveUrl, setLiveUrl] = useState(task.publishedUrl ?? '');
    const [urlError, setUrlError] = useState<string | null>(null);
    const [estimateError, setEstimateError] = useState<string | null>(null);
    const [assigneeOpen, setAssigneeOpen] = useState(false);
    const [labelOpen, setLabelOpen] = useState(false);
    const [blockedOpen, setBlockedOpen] = useState(false);
    const [blockedDraft, setBlockedDraft] = useState('');
    const [blockedError, setBlockedError] = useState<string | null>(null);
    const [parentOpen, setParentOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const titleDirty = useRef(false);
    const descriptionDirty = useRef(false);
    const estimateDirty = useRef(false);
    const titleTimer = useRef<number | null>(null);
    const descriptionTimer = useRef<number | null>(null);
    const titleRef = useRef(title);
    const descriptionRef = useRef(description);
    titleRef.current = title;
    descriptionRef.current = description;

    useEffect(() => {
        titleDirty.current = false;
        descriptionDirty.current = false;
        estimateDirty.current = false;
        setTitle(task.title);
        setDescription(task.description);
        setEstimate(formatPlanEstimateInput(task.estimatedHours));
        setLiveUrl(task.publishedUrl ?? '');
        setUrlError(null);
        setEstimateError(null);
        setError(null);
        setConfirmDelete(false);
        setAssigneeOpen(false);
        setLabelOpen(false);
        setBlockedOpen(false);
        setBlockedDraft('');
        setBlockedError(null);
        setParentOpen(false);
        // The id is the only signal. Title and description from this render belong to the task being opened.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task.id]);

    useEffect(() => {
        if (descriptionDirty.current || !task.detailsReady) return;
        setDescription(task.description);
        setEstimate(formatPlanEstimateInput(task.estimatedHours));
    }, [task.detailsReady, task.description, task.estimatedHours, task.id]);

    useEffect(() => {
        if (focusField === 'assignee') setAssigneeOpen(true);
        if (focusField === 'due') {
            const node = rootRef.current?.querySelector('[data-plan-field="due"]');
            if (node instanceof HTMLElement) node.focus();
        }
        if (focusField === 'assignee') {
            const node = rootRef.current?.querySelector('[data-plan-field="assignee"]');
            if (node instanceof HTMLElement) node.focus();
        }
    }, [focusField, task.id]);

    const persist = useCallback(async (taskId: string, save: PlanPanelSave | null) => {
        if (!save) return;
        setPending(count => count + 1);
        setError(null);
        try {
            const message = await saveRef.current(taskId, save);
            if (message) setError(message);
        } catch (caught) {
            setError(caught instanceof Error && caught.message ? caught.message : 'Could not save that change.');
        } finally {
            setPending(count => count - 1);
        }
    }, []);

    function commit(save: PlanPanelSave | null) {
        void persist(task.id, save);
    }

    useEffect(() => {
        const taskId = task.id;
        const savedTitle = task.title;
        const savedDescription = task.description;
        return () => {
            if (titleTimer.current) {
                window.clearTimeout(titleTimer.current);
                titleTimer.current = null;
            }
            if (descriptionTimer.current) {
                window.clearTimeout(descriptionTimer.current);
                descriptionTimer.current = null;
            }
            if (titleDirty.current) {
                const latest = planTitleSave(titleRef.current, savedTitle);
                titleDirty.current = false;
                if (latest) void persist(taskId, { field: 'title', title: latest });
            }
            if (descriptionDirty.current) {
                const latest = planDescriptionSave(descriptionRef.current, savedDescription);
                descriptionDirty.current = false;
                if (latest != null) void persist(taskId, { field: 'description', description: latest });
            }
        };
    }, [task.id, task.title, task.description, persist]);

    useEffect(() => {
        if (!titleDirty.current) return;
        const taskId = task.id;
        const savedTitle = task.title;
        const value = planTitleSave(title, savedTitle);
        if (!value) return;
        titleTimer.current = window.setTimeout(() => {
            titleTimer.current = null;
            titleDirty.current = false;
            void persist(taskId, { field: 'title', title: value });
        }, autosaveMs);
        return () => {
            if (titleTimer.current) window.clearTimeout(titleTimer.current);
            titleTimer.current = null;
        };
    }, [title, task.title, task.id, autosaveMs, persist]);

    useEffect(() => {
        if (!descriptionDirty.current || !task.detailsReady) return;
        const taskId = task.id;
        const savedDescription = task.description;
        const value = planDescriptionSave(description, savedDescription);
        if (value == null) return;
        descriptionTimer.current = window.setTimeout(() => {
            descriptionTimer.current = null;
            descriptionDirty.current = false;
            void persist(taskId, { field: 'description', description: value });
        }, autosaveMs);
        return () => {
            if (descriptionTimer.current) window.clearTimeout(descriptionTimer.current);
            descriptionTimer.current = null;
        };
    }, [description, task.description, task.detailsReady, task.id, autosaveMs, persist]);

    function flushTitle() {
        if (titleTimer.current) {
            window.clearTimeout(titleTimer.current);
            titleTimer.current = null;
        }
        if (!titleDirty.current) return;
        const value = planTitleSave(title, task.title);
        if (!value) {
            titleDirty.current = false;
            return;
        }
        void commit({ field: 'title', title: value });
    }

    function flushDescription() {
        if (descriptionTimer.current) {
            window.clearTimeout(descriptionTimer.current);
            descriptionTimer.current = null;
        }
        if (!descriptionDirty.current || !task.detailsReady) return;
        const value = planDescriptionSave(description, task.description);
        if (value == null) return;
        void commit({ field: 'description', description: value });
    }

    function close() {
        flushTitle();
        flushDescription();
        onClose();
    }

    const due = planPanelDue({ dueDate: task.dueDate, status: task.status, completedAt: null }, today);
    const labels = readPlanLabels(task.category, task.detailsReady ? task.tags : task.category ? [] : []);
    const blockedReason = task.blockedReason?.trim() || null;
    const basecamp = planBasecampLine({
        linked: task.basecampLinked,
        href: task.basecampHref,
        listName: task.basecampListName,
        lastSyncedAt: task.lastSyncedAt,
        now: now ?? new Date(),
    });
    const parent = planParentField(tasks, task.id);
    const selectedPeople = task.assigneeIds
        .map(id => people.find(person => person.id === id))
        .filter((person): person is PlanPanelPerson => Boolean(person));

    return (
        <aside
            ref={rootRef}
            data-plan-panel
            data-plan-width="380"
            aria-label="Task details"
            onKeyDown={event => {
                if (event.key !== 'Escape') return;
                if (!assigneeOpen && !labelOpen && !blockedOpen && !parentOpen && !confirmDelete) return;
                event.stopPropagation();
                setAssigneeOpen(false);
                setLabelOpen(false);
                setBlockedOpen(false);
                setBlockedError(null);
                setParentOpen(false);
                setConfirmDelete(false);
            }}
            className="sticky top-4 flex h-[calc(100vh-5rem)] w-[380px] max-w-full shrink-0 flex-col border-l border-[#2a2a2e] bg-[#111113] shadow-[-20px_0_50px_rgba(0,0,0,0.45)]"
        >
            <div className="flex items-center gap-2 border-b border-[#2a2a2e] px-3.5 py-3 text-[11px] text-[#8b8b93]">
                <span className="min-w-0 truncate">Task · {clientName}</span>
                <span className="sr-only" data-plan-save={pending > 0 ? 'saving' : error ? 'error' : 'idle'}>
                    {pending > 0 ? 'Saving' : 'Idle'}
                </span>
                <button
                    type="button"
                    aria-label="Close"
                    onClick={close}
                    className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-[#8b8b93] hover:bg-[#1d1d22] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
                <input
                    data-plan-field="title"
                    aria-label="Title"
                    value={title}
                    maxLength={300}
                    onChange={event => {
                        titleDirty.current = true;
                        setTitle(event.target.value);
                    }}
                    onBlur={flushTitle}
                    onKeyDown={event => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            event.currentTarget.blur();
                        }
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            event.currentTarget.blur();
                        }
                    }}
                    className="mb-2.5 w-full bg-transparent text-[15px] font-semibold leading-snug text-[#ececee] outline-none"
                />
                <textarea
                    data-plan-field="description"
                    aria-label="Description"
                    value={description}
                    disabled={!task.detailsReady}
                    placeholder={task.detailsReady ? 'Description, acceptance notes, links…' : 'Loading description…'}
                    onChange={event => {
                        descriptionDirty.current = true;
                        setDescription(event.target.value);
                    }}
                    onBlur={flushDescription}
                    onKeyDown={event => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            event.currentTarget.blur();
                        }
                    }}
                    className="min-h-[62px] w-full resize-y rounded-lg border border-[#2a2a2e] bg-[#0c0c0e] px-2 py-2 text-[12px] leading-relaxed text-[#cfcfd4] outline-none placeholder:text-[#6d6d75] focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:opacity-60"
                />
                {error && <p role="alert" data-plan-save-error className="mt-2 text-[11px] text-[#f87171]">{error}</p>}
                <div className="mt-2.5">
                    <Field label="Due">
                        <input
                            data-plan-field="due"
                            aria-label="Due date"
                            type="date"
                            value={task.dueDate ?? ''}
                            onChange={event => { void commit({ field: 'dueDate', dueDate: event.target.value || null }); }}
                            className={cn(
                                'bg-transparent text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]',
                                due.late ? 'text-[#f87171]' : 'text-[#cfcfd4]',
                            )}
                        />
                        {task.dueDate && (
                            <span className={due.late ? 'text-[#f87171]' : 'text-[#8b8b93]'} data-plan-due-copy={due.text}>
                                {due.text}
                            </span>
                        )}
                        {task.dueDate && (
                            <button
                                type="button"
                                className="text-[11px] text-[#8b8b93] hover:text-white"
                                onClick={() => { void commit({ field: 'dueDate', dueDate: null }); }}
                            >
                                No date
                            </button>
                        )}
                    </Field>
                    <Field label="Status">
                        <select
                            data-plan-field="status"
                            data-plan-status-stored={task.status}
                            aria-label="Status"
                            value={task.status}
                            onChange={event => { void commit({ field: 'status', status: event.target.value as PlanPanelStatus }); }}
                            className="bg-transparent text-[12px] text-[#cfcfd4] outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                        >
                            {PLAN_PANEL_STATUSES.map(status => (
                                <option key={status} value={status}>{PLAN_PANEL_STATUS_LABEL[status]}</option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Assignee">
                        <button
                            type="button"
                            data-plan-field="assignee"
                            aria-expanded={assigneeOpen}
                            onClick={() => setAssigneeOpen(open => !open)}
                            className="inline-flex items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                        >
                            {selectedPeople.length === 0 && <span className="text-[#8b8b93]">Unassigned</span>}
                            {selectedPeople.map(person => (
                                <span key={person.id} className="inline-flex items-center gap-1">
                                    <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#2a2a2e] text-[8px] font-medium text-[#ececee]">
                                        {person.initials}
                                    </span>
                                    {person.name}
                                </span>
                            ))}
                        </button>
                        {assigneeOpen && (
                            <div data-plan-menu="assignee" className="mt-1 w-full rounded-md border border-[#2a2a2e] bg-[#141416] p-1">
                                {people.length === 0 && <p className="px-2 py-1 text-[11px] text-[#8b8b93]">No teammates</p>}
                                {people.map(person => {
                                    const checked = task.assigneeIds.includes(person.id);
                                    return (
                                        <label key={person.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-[#1d1d22]">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => {
                                                    void commit({
                                                        field: 'assignees',
                                                        assigneeIds: togglePlanValue(task.assigneeIds, person.id),
                                                    });
                                                }}
                                            />
                                            <span>{person.name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </Field>
                    <Field label="Estimate">
                        <input
                            data-plan-field="estimate"
                            aria-label="Estimate"
                            value={estimate}
                            disabled={!task.detailsReady}
                            placeholder={task.detailsReady ? 'Hours' : '…'}
                            onChange={event => {
                                estimateDirty.current = true;
                                setEstimate(event.target.value);
                                setEstimateError(null);
                            }}
                            onBlur={() => {
                                if (!estimateDirty.current || !task.detailsReady) return;
                                const parsed = parsePlanEstimate(estimate);
                                if (!parsed.ok) {
                                    setEstimateError(parsed.error);
                                    return;
                                }
                                estimateDirty.current = false;
                                void commit({ field: 'estimate', estimatedHours: parsed.hours });
                            }}
                            className="w-16 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:opacity-60"
                        />
                        <span className="text-[#8b8b93]">· {formatPlanHours(task.loggedHours)} logged</span>
                        {estimateError && <span className="text-[#f87171]">{estimateError}</span>}
                    </Field>
                    <Field label="Pillar">
                        {parent.kind === 'pillar' ? (
                            <span data-plan-pillar={parent.childCount} className="text-[#8b8b93]">
                                This is a pillar · {parent.childCount} {parent.childCount === 1 ? 'subtask' : 'subtasks'}
                            </span>
                        ) : parent.kind === 'locked' ? (
                            <span className="text-[#8b8b93]">{parent.currentTitle ?? 'None'}</span>
                        ) : (
                            <>
                                <span data-plan-parent={parent.currentId ?? 'none'}>{parent.currentTitle ?? 'None'}</span>
                                <button
                                    type="button"
                                    data-plan-field="parent"
                                    className="text-[11px] text-[#ec4899] hover:underline"
                                    onClick={() => setParentOpen(open => !open)}
                                >
                                    Move under…
                                </button>
                                {parentOpen && (
                                    <div data-plan-menu="parent" className="mt-1 max-h-40 w-full overflow-auto rounded-md border border-[#2a2a2e] bg-[#141416] p-1">
                                        <button
                                            type="button"
                                            data-plan-parent-choice="none"
                                            className="block w-full rounded px-2 py-1 text-left hover:bg-[#1d1d22]"
                                            onClick={() => {
                                                setParentOpen(false);
                                                void commit({ field: 'parent', parentTaskId: null });
                                            }}
                                        >
                                            None
                                        </button>
                                        {parent.choices.filter(choice => choice.id !== parent.currentId).map(choice => (
                                            <button
                                                key={choice.id}
                                                type="button"
                                                data-plan-parent-choice={choice.id}
                                                className="block w-full rounded px-2 py-1 text-left hover:bg-[#1d1d22]"
                                                onClick={() => {
                                                    setParentOpen(false);
                                                    void commit({ field: 'parent', parentTaskId: choice.id });
                                                }}
                                            >
                                                {choice.title}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </Field>
                    <Field label="Labels">
                        {labels.map(label => (
                            <button
                                key={label}
                                type="button"
                                data-plan-label={label}
                                disabled={!task.detailsReady}
                                onClick={() => {
                                    const next = togglePlanValue(labels, label);
                                    const written = writePlanLabels(next, task.tags);
                                    void commit({ field: 'labels', ...written });
                                }}
                                className="rounded border border-[#2a2a2e] px-1.5 py-0.5 text-[10.5px] text-[#cfcfd4] hover:text-white disabled:opacity-60"
                            >
                                {planLabelText(label)} ×
                            </button>
                        ))}
                        {blockedReason && (
                            <span
                                data-plan-blocked
                                title={`Blocked: ${blockedReason}`}
                                className="inline-flex max-w-full items-center gap-1 rounded border border-[#2a2a2e] px-1.5 py-0.5 text-[10.5px] text-[#cfcfd4]"
                            >
                                <span className="min-w-0 break-words">Blocked: {blockedReason}</span>
                                <button
                                    type="button"
                                    data-plan-blocked-remove
                                    aria-label="Remove blocked label"
                                    onClick={() => { void commit({ field: 'blocked', blockedReason: null }); }}
                                    className="shrink-0 hover:text-white"
                                >
                                    ×
                                </button>
                            </span>
                        )}
                        <button
                            type="button"
                            data-plan-field="labels"
                            disabled={!task.detailsReady}
                            className="text-[11px] text-[#ec4899] hover:underline disabled:opacity-60"
                            onClick={() => setLabelOpen(open => !open)}
                        >
                            + Label
                        </button>
                        {labelOpen && (
                            <div data-plan-menu="labels" className="mt-1 w-full rounded-md border border-[#2a2a2e] bg-[#141416] p-1">
                                {PLAN_LABELS.map(label => (
                                    <label key={label.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-[#1d1d22]">
                                        <input
                                            type="checkbox"
                                            checked={labels.includes(label.id)}
                                            onChange={() => {
                                                const next = togglePlanValue(labels, label.id);
                                                const written = writePlanLabels(next, task.tags);
                                                void commit({ field: 'labels', ...written });
                                            }}
                                        />
                                        <span>{label.label}</span>
                                    </label>
                                ))}
                                {task.status !== 'done' && (
                                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-[#1d1d22]">
                                        <input
                                            type="checkbox"
                                            data-plan-blocked-add
                                            checked={Boolean(blockedReason)}
                                            onChange={() => {
                                                if (blockedReason) {
                                                    void commit({ field: 'blocked', blockedReason: null });
                                                    return;
                                                }
                                                setLabelOpen(false);
                                                setBlockedDraft('');
                                                setBlockedError(null);
                                                setBlockedOpen(true);
                                            }}
                                        />
                                        <span>Blocked</span>
                                    </label>
                                )}
                            </div>
                        )}
                        {blockedOpen && task.status !== 'done' && !blockedReason && (
                            <form
                                data-plan-menu="blocked"
                                className="mt-1 w-full space-y-1"
                                onSubmit={event => {
                                    event.preventDefault();
                                    const parsed = normalizeBlockedReason(blockedDraft);
                                    if (!parsed.ok) {
                                        setBlockedError(parsed.error);
                                        return;
                                    }
                                    setBlockedOpen(false);
                                    setBlockedError(null);
                                    void commit({ field: 'blocked', blockedReason: parsed.reason });
                                }}
                            >
                                <label htmlFor={`${task.id}-blocked`} className="sr-only">Why is this blocked?</label>
                                <input
                                    id={`${task.id}-blocked`}
                                    data-plan-field="blocked-reason"
                                    value={blockedDraft}
                                    maxLength={200}
                                    autoFocus
                                    placeholder="One-line reason"
                                    onChange={event => {
                                        setBlockedDraft(event.target.value);
                                        setBlockedError(null);
                                    }}
                                    className="w-full rounded border border-[#2a2a2e] bg-transparent px-2 py-1 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                                />
                                {blockedError && <p className="text-[11px] text-[#f87171]">{blockedError}</p>}
                                <div className="flex gap-2">
                                    <button type="submit" className="rounded bg-[#ec4899] px-2 py-1 text-[11px] font-semibold text-white">Save block</button>
                                    <button
                                        type="button"
                                        className="rounded border border-[#2a2a2e] px-2 py-1 text-[11px]"
                                        onClick={() => { setBlockedOpen(false); setBlockedError(null); }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        )}
                    </Field>
                    <Field label="Onboarding">
                        <button
                            type="button"
                            data-plan-field="onboarding"
                            data-plan-onboarding={task.stage === 'onboarding' ? 'yes' : 'no'}
                            aria-pressed={task.stage === 'onboarding'}
                            onClick={() => {
                                void commit({
                                    field: 'onboarding',
                                    stage: planOnboardingStage(task.stage !== 'onboarding'),
                                });
                            }}
                            className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                        >
                            {task.stage === 'onboarding' ? 'Yes, shows in Onboarding' : 'No'}
                        </button>
                    </Field>
                    <Field label="Live URL">
                        {task.publishedUrl ? (
                            <a
                                href={task.publishedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex max-w-full items-center gap-1 truncate text-[#ec4899] hover:underline"
                            >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                <span className="truncate">{urlHost(task.publishedUrl)}</span>
                            </a>
                        ) : (
                            <span className="text-[#8b8b93]">Added when checked off</span>
                        )}
                        <input
                            data-plan-field="live-url"
                            aria-label="Live URL"
                            value={liveUrl}
                            placeholder="Paste live URL"
                            onChange={event => {
                                setLiveUrl(event.target.value);
                                setUrlError(null);
                            }}
                            onBlur={() => {
                                const parsed = planLiveUrlSave(liveUrl);
                                if (!parsed.ok) {
                                    setUrlError(parsed.error);
                                    return;
                                }
                                if ((parsed.publishedUrl ?? null) === (task.publishedUrl ?? null)) return;
                                void commit({ field: 'liveUrl', publishedUrl: parsed.publishedUrl });
                            }}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                }
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setLiveUrl(task.publishedUrl ?? '');
                                    event.currentTarget.blur();
                                }
                            }}
                            className="w-full bg-transparent text-[12px] outline-none placeholder:text-[#6d6d75] focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                        />
                        {urlError && <span className="text-[#f87171]">{urlError}</span>}
                    </Field>
                    <Field label="Basecamp">
                        {basecamp.href ? (
                            <a
                                data-plan-basecamp="link"
                                href={basecamp.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[#cfcfd4] hover:text-white"
                            >
                                {basecamp.label}
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        ) : (
                            <span data-plan-basecamp={basecamp.linked ? 'linked' : 'none'} className="text-[#8b8b93]">
                                {basecamp.label}
                            </span>
                        )}
                        {basecamp.synced && <span className="text-[#8b8b93]">· {basecamp.synced}</span>}
                    </Field>
                </div>
                <h3 className="mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#8b8b93]">Time</h3>
                {task.timeByMonth.length === 0 ? (
                    <p data-plan-time="empty" className="text-[11.5px] text-[#8b8b93]">No time logged</p>
                ) : task.timeByMonth.map(month => (
                    <div key={month.month} data-plan-time={month.month} className="flex justify-between border-t border-[#2a2a2e] py-1 text-[11.5px]">
                        <span>{month.label}</span>
                        <span className="text-[#8b8b93] tabular-nums">{formatPlanHours(month.hours)}</span>
                    </div>
                ))}
                <p className="mt-1.5 text-[10.5px] text-[#6d6d75]">Entries are edited in Timesheets.</p>
            </div>
            <div className="flex items-center gap-2 border-t border-[#2a2a2e] px-3.5 py-2.5 text-[11px] text-[#8b8b93]">
                <span data-plan-created>{formatPlanCreated(task.createdAt, task.createdByLabel)}</span>
                {confirmDelete ? (
                    <span className="ml-auto flex items-center gap-2">
                        <span>{planDeleteCopy(task.childCount)}</span>
                        <button
                            type="button"
                            data-plan-delete-confirm
                            className="text-[#f87171] hover:underline"
                            onClick={() => {
                                void onDelete().then(message => {
                                    if (message) setError(message);
                                });
                            }}
                        >
                            Delete
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(false)} className="hover:text-white">Cancel</button>
                    </span>
                ) : (
                    <span className="ml-auto flex items-center gap-2">
                        <button
                            type="button"
                            data-plan-duplicate
                            className="hover:text-white"
                            onClick={() => {
                                void onDuplicate().then(message => {
                                    if (message) setError(message);
                                });
                            }}
                        >
                            Duplicate
                        </button>
                        <button
                            type="button"
                            data-plan-delete
                            className="hover:text-white"
                            onClick={() => setConfirmDelete(true)}
                        >
                            Delete
                        </button>
                    </span>
                )}
            </div>
        </aside>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid min-h-8 grid-cols-[104px_minmax(0,1fr)] items-start gap-2 border-t border-[#2a2a2e] py-1.5 text-[12px] first:border-t-0">
            <span className="pt-0.5 text-[#8b8b93]">{label}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[#cfcfd4]">{children}</div>
        </div>
    );
}

function urlHost(url: string): string {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
        return `${parsed.host}${path}`;
    } catch {
        return url;
    }
}
