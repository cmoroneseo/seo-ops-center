'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    groupTasksByStage,
    stageListTitleParts,
    type StageListGroup,
    type StageListSection,
    type StageListTask,
} from '@/lib/seo-plan/stage-list';

const CATEGORY_LABELS: Record<string, string> = {
    content: 'Content',
    technical: 'Technical',
    local: 'Local',
    links: 'Links',
    strategy: 'Strategy',
    admin: 'Admin',
};

const ROW_GRID = 'grid grid-cols-1 items-center gap-1 border-t border-border py-2.5 md:grid-cols-[minmax(0,1fr)_160px_120px_110px] md:gap-3';

function statusLabel(status: string): string {
    if (status === 'in_progress') return 'In progress';
    if (status === 'todo') return 'To do';
    if (status === 'done') return 'Done';
    if (status === 'approved') return 'Approved';
    if (status === 'review') return 'Review';
    if (status === 'blocked') return 'Blocked';
    return status.replaceAll('_', ' ');
}

function statusDot(status: string): string {
    if (status === 'in_progress') return 'bg-blue-500';
    if (status === 'review') return 'bg-amber-500';
    if (status === 'done' || status === 'approved') return 'bg-emerald-600';
    if (status === 'blocked') return 'bg-red-500';
    return 'bg-muted-foreground/40';
}

function categoryLabel(category: string | null): string {
    if (!category) return '';
    return CATEGORY_LABELS[category] ?? category;
}

function TitleText({ title, query, done }: { title: string; query: string; done: boolean }) {
    const parts = stageListTitleParts(title, query);
    return (
        <span className={cn(done && 'text-muted-foreground line-through')}>
            {parts.map((part, index) => part.match
                ? <mark key={index} className="rounded-sm bg-primary/15 px-0.5 text-inherit">{part.text}</mark>
                : <span key={index}>{part.text}</span>)}
        </span>
    );
}

function StageSections({
    sections,
    query,
    searching,
    onOpenTask,
}: {
    sections: StageListSection[];
    query: string;
    searching: boolean;
    onOpenTask: (taskId: string) => void;
}) {
    const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
    const baseId = useId();

    const isOpen = (group: StageListGroup) => {
        if (group.task.id in openOverrides) return openOverrides[group.task.id];
        return searching ? group.expandChildren : true;
    };

    const renderRow = (task: StageListTask, options: {
        role: 'task' | 'subtask';
        parentTitle?: string;
        parentId?: string;
        className?: string;
        leading?: ReactNode;
        extra?: ReactNode;
        key?: string;
    }) => {
        const done = task.status === 'done' || task.status === 'approved';
        return (
            <div
                key={options.key}
                data-stage-role={options.role}
                data-task-id={task.id}
                data-parent-id={options.parentId}
                className={cn(ROW_GRID, options.className)}
            >
                <div className="flex min-w-0 items-start gap-2">
                    {options.leading ?? <span className="w-4 shrink-0" />}
                    <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', statusDot(task.status))} aria-hidden="true" />
                    <div className="min-w-0">
                        <button
                            type="button"
                            onClick={() => onOpenTask(task.id)}
                            className="break-words text-left text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            {options.parentTitle && <span className="sr-only">Subtask of {options.parentTitle}. </span>}
                            <TitleText title={task.title} query={query} done={done} />
                        </button>
                        {options.parentTitle && <div className="text-xs text-muted-foreground">in {options.parentTitle}</div>}
                        {options.extra}
                    </div>
                </div>
                <span className="text-sm text-muted-foreground">{categoryLabel(task.category)}</span>
                <span className="text-sm text-muted-foreground">{statusLabel(task.status)}</span>
                <span className="text-sm text-muted-foreground">{task.basecamp ? 'Basecamp' : ''}</span>
            </div>
        );
    };

    return (
        <>
            {sections.map(section => {
                const headingId = `${baseId}-${section.stage}`;
                return (
                    <section key={section.stage} data-stage={section.stage} aria-labelledby={headingId}>
                        <h3 id={headingId} className="flex items-center gap-2 bg-muted/70 px-4 py-3 text-sm font-semibold">
                            {section.label}
                            <span className="text-xs font-normal text-muted-foreground" data-count={section.count}>{section.count}</span>
                            <span className="sr-only">{section.count === 1 ? 'task' : 'tasks'}</span>
                        </h3>
                        {section.groups.length === 0 ? (
                            <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">No tasks</p>
                        ) : section.groups.map(group => {
                            const open = isOpen(group);
                            const panelId = `${baseId}-children-${group.task.id}`;
                            const subtaskLabel = group.children.length === 1 ? '1 subtask' : `${group.children.length} subtasks`;
                            return (
                                <div key={group.task.id}>
                                    {renderRow(group.task, {
                                        key: group.task.id,
                                        role: 'task',
                                        className: 'px-4',
                                        leading: group.children.length > 0 ? (
                                            <button
                                                type="button"
                                                aria-expanded={open}
                                                aria-controls={panelId}
                                                aria-label={`${open ? 'Hide' : 'Show'} ${subtaskLabel} of ${group.task.title}`}
                                                onClick={() => setOpenOverrides(current => ({ ...current, [group.task.id]: !open }))}
                                                className="mt-0.5 text-muted-foreground hover:text-foreground"
                                            >
                                                <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
                                            </button>
                                        ) : undefined,
                                        extra: (
                                            <>
                                                {group.parentBreadcrumb && (
                                                    <div className="text-xs text-muted-foreground">{group.parentBreadcrumb}</div>
                                                )}
                                                {group.childCount > 0 && (
                                                    <div className="mt-1 text-xs text-primary">Pillar · {group.childDone}/{group.childCount}</div>
                                                )}
                                            </>
                                        ),
                                    })}
                                    {open && group.children.length > 0 && (
                                        <div id={panelId} data-stage-children={group.task.id}>
                                            {group.children.map(child => renderRow(child, {
                                                key: child.id,
                                                role: 'subtask',
                                                parentTitle: group.task.title,
                                                parentId: group.task.id,
                                                className: 'pl-11 pr-4',
                                            }))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </section>
                );
            })}
        </>
    );
}

/**
 * Read-only stage list. Collapse state is local. Stage and position are not edited here.
 */
export function StagePlanListView({
    tasks,
    query,
    onQueryChange,
    onOpenTask,
    clientName,
}: {
    tasks: readonly StageListTask[];
    query: string;
    onQueryChange: (query: string) => void;
    onOpenTask: (taskId: string) => void;
    clientName?: string;
}) {
    const searchId = useId();
    const sections = groupTasksByStage(tasks, query);
    const searching = query.trim().length > 0;
    const label = clientName ? `Search tasks for ${clientName}` : 'Search tasks and subtasks';

    return (
        <div data-seo-plan-stage-list className="space-y-3">
            <label htmlFor={searchId} className="sr-only">{label}</label>
            <input
                id={searchId}
                type="search"
                value={query}
                onChange={event => onQueryChange(event.target.value)}
                placeholder="Search all tasks and subtasks…"
                className="w-full max-w-sm rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <div className="overflow-hidden rounded-xl border border-border bg-card">
                <StageSections key={query} sections={sections} query={query} searching={searching} onOpenTask={onOpenTask} />
            </div>
        </div>
    );
}
