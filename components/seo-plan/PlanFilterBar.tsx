'use client';

import { useId, type RefObject } from 'react';
import {
    EMPTY_PLAN_FILTERS,
    PLAN_FILTER_PRIORITY_OPTIONS,
    PLAN_FILTER_STATUS_OPTIONS,
    PLAN_QUICK_VIEWS,
    activePlanFilterCount,
    filtersForPreset,
    matchingPlanPreset,
    planFilterCountLabel,
    planStageOptions,
    type PlanBoardFilters,
    type PlanFilterBoard,
    type PlanFilterPriority,
    type PlanFilterStage,
    type PlanFilterStatus,
    type PlanQuickView,
} from '@/lib/seo-plan/plan-filters';
import type { PartOfChoice } from '@/lib/tasks/part-of';
import { cn } from '@/lib/utils';

const SELECT = 'max-w-48 rounded-lg border border-[#e4e4e7] bg-[#ffffff] px-2 py-1.5 text-[13px] text-[#18181b] outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]';

/**
 * Status, priority, assignee, stage, Part of, and title search.
 * Quick views set those same filters. Clear removes all of them.
 */
export function PlanFilterBar({
    board,
    query,
    filters,
    people,
    viewerId,
    partOfChoices,
    searchRef,
    onQueryChange,
    onFiltersChange,
}: {
    board: PlanFilterBoard;
    query: string;
    filters: PlanBoardFilters;
    people: readonly { id: string; name: string }[];
    viewerId: string | null;
    partOfChoices: readonly PartOfChoice[];
    searchRef: RefObject<HTMLInputElement | null>;
    onQueryChange: (query: string) => void;
    onFiltersChange: (filters: PlanBoardFilters) => void;
}) {
    const searchId = useId();
    const partOfValue = partOfChoices.some(choice => choice.id === filters.partOf) ? filters.partOf : '';
    const stageOptions = planStageOptions(board);
    const stageValue = stageOptions.some(option => option.value === filters.stage) ? filters.stage : '';
    const count = activePlanFilterCount(
        { ...filters, query, partOf: partOfValue, stage: stageValue },
        board,
        true,
    );
    const preset = matchingPlanPreset({ ...filters, query, partOf: partOfValue, stage: stageValue }, viewerId);
    const assigneeKnown = filters.assignee === 'none'
        || people.some(person => person.id === filters.assignee)
        || filters.assignee === viewerId;
    const sortedPeople = [...people].sort((a, b) => a.name.localeCompare(b.name));

    const apply = (next: PlanBoardFilters, nextQuery = query) => {
        onFiltersChange(next);
        if (nextQuery !== query) onQueryChange(nextQuery);
    };
    const clear = () => apply(EMPTY_PLAN_FILTERS, '');
    const chooseView = (view: PlanQuickView) => {
        if (preset === view) {
            clear();
            return;
        }
        const next = filtersForPreset(view, viewerId);
        if (!next) return;
        apply(next, '');
    };

    return (
        <div data-plan-filters role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
            {PLAN_QUICK_VIEWS.map(view => {
                const pressed = preset === view.id;
                const disabled = view.id === 'mine' && !viewerId;
                return (
                    <button
                        key={view.id}
                        type="button"
                        data-plan-view={view.id}
                        aria-pressed={pressed}
                        disabled={disabled}
                        onClick={() => chooseView(view.id)}
                        className={cn(
                            'rounded-full border px-2.5 py-1 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:opacity-50',
                            pressed
                                ? 'border-[#ec4899] bg-[#ec4899]/15 text-[#ec4899]'
                                : 'border-[#e4e4e7] bg-[#ffffff] text-[#3f3f46] hover:text-[#18181b]',
                        )}
                    >
                        {view.label}
                    </button>
                );
            })}
            <label>
                <span className="sr-only">Status</span>
                <select
                    aria-label="Status"
                    data-plan-filter="status"
                    value={filters.status}
                    onChange={event => {
                        const value = event.target.value;
                        const status = PLAN_FILTER_STATUS_OPTIONS.some(option => option.value === value)
                            ? value as PlanFilterStatus
                            : '';
                        apply({ ...filters, status });
                    }}
                    className={SELECT}
                >
                    <option value="">Any status</option>
                    {PLAN_FILTER_STATUS_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </label>
            <label>
                <span className="sr-only">Priority</span>
                <select
                    aria-label="Priority"
                    data-plan-filter="priority"
                    value={filters.priority}
                    onChange={event => {
                        const value = event.target.value;
                        const priority = PLAN_FILTER_PRIORITY_OPTIONS.some(option => option.value === value)
                            ? value as PlanFilterPriority
                            : '';
                        apply({ ...filters, priority });
                    }}
                    className={SELECT}
                >
                    <option value="">Any priority</option>
                    {PLAN_FILTER_PRIORITY_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </label>
            <label>
                <span className="sr-only">Assignee</span>
                <select
                    aria-label="Assignee"
                    data-plan-filter="assignee"
                    value={filters.assignee === 'none' || assigneeKnown ? filters.assignee : ''}
                    onChange={event => apply({ ...filters, assignee: event.target.value })}
                    className={SELECT}
                >
                    <option value="">Anyone</option>
                    <option value="none">Unassigned</option>
                    {filters.assignee && filters.assignee !== 'none' && !people.some(person => person.id === filters.assignee) && (
                        <option value={filters.assignee}>Teammate</option>
                    )}
                    {sortedPeople.map(person => (
                        <option key={person.id} value={person.id}>{person.name}</option>
                    ))}
                </select>
            </label>
            <label>
                <span className="sr-only">Stage</span>
                <select
                    aria-label="Stage"
                    data-plan-filter="stage"
                    value={stageValue}
                    onChange={event => {
                        const value = event.target.value;
                        const stage = stageOptions.some(option => option.value === value)
                            ? value as PlanFilterStage
                            : '';
                        apply({ ...filters, stage });
                    }}
                    className={SELECT}
                >
                    <option value="">Any stage</option>
                    {stageOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </label>
            {partOfChoices.length > 0 ? (
                <label>
                    <span className="sr-only">Part of</span>
                    <select
                        aria-label="Part of"
                        data-plan-part-of
                        value={partOfValue}
                        onChange={event => apply({ ...filters, partOf: event.target.value })}
                        className={SELECT}
                    >
                        <option value="">All tasks</option>
                        {partOfChoices.map(choice => (
                            <option key={choice.id} value={choice.id}>{choice.title}</option>
                        ))}
                    </select>
                </label>
            ) : null}
            <label htmlFor={searchId} className="sr-only">Search tasks</label>
            <input
                ref={searchRef}
                id={searchId}
                type="search"
                value={query}
                data-plan-search
                onChange={event => onQueryChange(event.target.value)}
                placeholder="Search tasks"
                className="w-56 max-w-full rounded-lg border border-[#e4e4e7] bg-[#ffffff] px-3 py-1.5 text-[13px] text-[#18181b] outline-none placeholder:text-[#a1a1aa] focus-visible:ring-2 focus-visible:ring-[#ec4899]"
            />
            {count > 0 && (
                <>
                    <span data-plan-filter-count className="text-[12px] text-[#71717a]">{planFilterCountLabel(count)}</span>
                    <button
                        type="button"
                        data-plan-filter-clear
                        onClick={clear}
                        className="text-[12px] font-medium text-[#ec4899] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                    >
                        Clear
                    </button>
                </>
            )}
        </div>
    );
}
