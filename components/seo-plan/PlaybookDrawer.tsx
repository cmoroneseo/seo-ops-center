'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import {
    PLAYBOOK_COPY,
    playbookAddCalls,
    playbookAddLabel,
    playbookAddTitles,
    playbookCatalog,
    playbookChoiceId,
    playbookChoices,
    playbookItems,
    playbookMatching,
    playbookRowState,
    type PlaybookAddCall,
    type PlaybookExisting,
    type PlaybookItem,
    type PlaybookOrgTask,
    type PlaybookRowState,
    type PlaybookScope,
} from '@/lib/seo-plan/playbook';
import type { PlanBoard } from '@/lib/seo-plan/plan-phases';
import { cn } from '@/lib/utils';

/**
 * Side drawer for adding saved tasks to one stage.
 * Search, groups, and the duplicate marks are decided in lib/seo-plan/playbook.
 * The add button calls the plan's existing task create path.
 */
export function PlaybookDrawer({
    board,
    month,
    today,
    openedFrom,
    tasks,
    planRows = [],
    orgTasks = [],
    orgTasksReady = true,
    checklistScope = {},
    onClose,
    onAdd,
}: {
    board: PlanBoard;
    month: string;
    today: string;
    openedFrom: string | null;
    tasks: readonly { title: string; status?: string; excluded?: boolean }[];
    planRows?: readonly PlaybookExisting[];
    orgTasks?: readonly PlaybookOrgTask[];
    orgTasksReady?: boolean;
    checklistScope?: PlaybookScope;
    onClose: () => void;
    onAdd: (input: PlaybookAddCall) => Promise<void>;
}) {
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [choiceId, setChoiceId] = useState(() => playbookChoiceId(board, openedFrom));
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const catalog = useMemo(() => playbookCatalog(orgTasks, checklistScope), [orgTasks, checklistScope]);
    const allItems = useMemo(() => playbookItems(catalog), [catalog]);
    const visible = useMemo(() => playbookMatching(catalog, query), [catalog, query]);
    const existing = useMemo(
        () => [
            ...tasks.map(task => ({ title: task.title, status: task.status, excluded: task.excluded })),
            ...planRows,
        ],
        [tasks, planRows],
    );
    const selectedItems = allItems.filter(item => selected.has(item.id));
    const choices = playbookChoices(board, month, today);
    const choice = choices.find(item => item.id === choiceId) ?? choices[0];
    const titles = choice ? playbookAddTitles(selectedItems, existing) : [];

    useEffect(() => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        searchRef.current?.focus();
        return () => {
            if (opener && opener.isConnected) opener.focus();
        };
    }, []);

    function rowState(item: PlaybookItem): PlaybookRowState {
        return playbookRowState(item, existing, selectedItems);
    }

    function selectItems(items: readonly PlaybookItem[], clear: boolean) {
        setSelected(current => {
            const next = new Set(current);
            if (clear) {
                for (const item of items) next.delete(item.id);
                return next;
            }
            const chosen = allItems.filter(row => next.has(row.id));
            for (const item of items) {
                if (playbookRowState(item, existing, chosen) !== 'open') continue;
                next.add(item.id);
                chosen.push(item);
            }
            return next;
        });
    }

    function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Escape' && !busy) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key !== 'Tab' || !dialogRef.current) return;
        const focusable = focusableIn(dialogRef.current);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first?.focus();
        }
    }

    async function add() {
        if (!choice || titles.length === 0 || busy) return;
        const calls = playbookAddCalls(titles, choice);
        setBusy(true);
        setError(null);
        let landed = 0;
        try {
            for (const call of calls) {
                await onAdd(call);
                landed += 1;
            }
            onClose();
        } catch {
            setError(landed > 0 ? PLAYBOOK_COPY.partial : PLAYBOOK_COPY.error);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex justify-end bg-black/40"
            data-playbook-backdrop
            onMouseDown={() => { if (!busy) onClose(); }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                data-playbook-drawer
                data-plan-menu
                tabIndex={-1}
                onMouseDown={event => event.stopPropagation()}
                onKeyDown={trapFocus}
                className="flex h-full w-full max-w-md flex-col border-l border-[#e4e4e7] bg-[#ffffff] text-[#18181b] shadow-[-12px_0_32px_rgba(24,24,27,0.12)] outline-none"
            >
                <div className="flex items-start gap-3 border-b border-[#e4e4e7] px-4 py-3">
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-sm font-semibold">{PLAYBOOK_COPY.title}</h2>
                        <p className="mt-1 text-[13px] leading-5 text-[#3f3f46]">{PLAYBOOK_COPY.intro}</p>
                    </div>
                    <button
                        type="button"
                        aria-label={PLAYBOOK_COPY.close}
                        disabled={busy}
                        onClick={onClose}
                        className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#71717a] hover:bg-[#f4f4f6] hover:text-[#18181b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:opacity-50"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-3 border-b border-[#e4e4e7] px-4 py-3">
                    <input
                        ref={searchRef}
                        type="search"
                        value={query}
                        disabled={busy}
                        data-playbook-search
                        aria-label={PLAYBOOK_COPY.search}
                        placeholder={PLAYBOOK_COPY.search}
                        onChange={event => setQuery(event.target.value)}
                        className="w-full rounded-lg border border-[#e4e4e7] bg-[#ffffff] px-3 py-2 text-[13px] outline-none placeholder:text-[#a1a1aa] focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:opacity-60"
                    />
                    {choice && (
                        <fieldset>
                            <legend className="mb-2 text-[13px] font-medium">{PLAYBOOK_COPY.stage}</legend>
                            <div className="flex flex-wrap gap-2">
                                {choices.map(option => (
                                    <label
                                        key={option.id}
                                        className={cn(
                                            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]',
                                            option.id === choice.id ? 'border-[#ec4899] text-[#18181b]' : 'border-[#e4e4e7] text-[#3f3f46]',
                                        )}
                                    >
                                        <input
                                            type="radio"
                                            name="playbook-stage"
                                            value={option.id}
                                            checked={option.id === choice.id}
                                            disabled={busy}
                                            data-playbook-stage={option.id}
                                            onChange={() => setChoiceId(option.id)}
                                        />
                                        {option.label}
                                    </label>
                                ))}
                            </div>
                            <p className="mt-2 text-[12px] leading-5 text-[#52525b]" data-playbook-stage-detail>{choice.detail}</p>
                        </fieldset>
                    )}
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">
                    {visible.length === 0 && orgTasksReady && (
                        <p className="py-6 text-[13px] text-[#71717a]" data-playbook-empty>{PLAYBOOK_COPY.noMatch}</p>
                    )}
                    {visible.map(section => {
                        const flat = section.groups.flatMap(group => group.items);
                        const single = section.groups.length === 1 && section.groups[0]?.title === section.title;
                        return (
                            <section key={section.id} data-playbook-section={section.id}>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <h3 className="text-[13px] font-semibold">{section.title}</h3>
                                    <SelectControl
                                        target={`section:${section.id}`}
                                        items={flat}
                                        busy={busy}
                                        action={groupAction(flat, item => rowState(item))}
                                        onSelect={selectItems}
                                    />
                                </div>
                                {section.groups.map(group => (
                                    <div key={group.id} data-playbook-group={group.id} className="mb-3">
                                        {!single && (
                                            <div className="mb-1 flex items-center justify-between gap-3">
                                                <h4 className="text-[12px] font-medium text-[#52525b]">{group.title}</h4>
                                                <SelectControl
                                                    target={`group:${group.id}`}
                                                    items={group.items}
                                                    busy={busy}
                                                    action={groupAction(group.items, item => rowState(item))}
                                                    onSelect={selectItems}
                                                />
                                            </div>
                                        )}
                                        <ul>
                                            {group.items.map(item => {
                                                const state = rowState(item);
                                                const locked = state === 'plan' || state === 'same';
                                                const note = state === 'plan'
                                                    ? PLAYBOOK_COPY.already
                                                    : state === 'same'
                                                        ? PLAYBOOK_COPY.same
                                                        : item.description;
                                                return (
                                                    <li key={item.id} className="border-t border-[#f4f4f5]">
                                                        <label className={cn('flex items-start gap-2 py-2', locked && 'text-[#71717a]')}>
                                                            <input
                                                                type="checkbox"
                                                                className="mt-1"
                                                                checked={state === 'chosen'}
                                                                disabled={busy || locked}
                                                                data-playbook-item={item.id}
                                                                data-playbook-title={item.title}
                                                                data-playbook-state={state}
                                                                onChange={() => {
                                                                    setSelected(current => {
                                                                        const next = new Set(current);
                                                                        if (next.has(item.id)) next.delete(item.id);
                                                                        else next.add(item.id);
                                                                        return next;
                                                                    });
                                                                }}
                                                            />
                                                            <span className="min-w-0">
                                                                <span className="block text-[13px] font-medium">{item.title}</span>
                                                                {note && (
                                                                    <span
                                                                        className="mt-0.5 block text-[12px] leading-5 text-[#71717a]"
                                                                        data-playbook-note={locked ? state : undefined}
                                                                    >
                                                                        {note}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </label>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                ))}
                            </section>
                        );
                    })}
                    {!orgTasksReady && (
                        <p className="text-[13px] text-[#71717a]" data-playbook-loading>{PLAYBOOK_COPY.loading}</p>
                    )}
                </div>

                <div className="border-t border-[#e4e4e7] px-4 py-3">
                    {error && <p role="alert" className="mb-2 text-[13px] text-[#991b1b]">{error}</p>}
                    <button
                        type="button"
                        data-playbook-add
                        disabled={busy || titles.length === 0}
                        onClick={() => { void add(); }}
                        className="w-full rounded-lg bg-[#ec4899] px-3 py-2 text-[13px] font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] focus-visible:ring-offset-2 disabled:opacity-50"
                    >
                        {busy ? PLAYBOOK_COPY.adding : titles.length === 0 ? PLAYBOOK_COPY.addNone : playbookAddLabel(titles.length)}
                    </button>
                </div>
            </div>
        </div>
    );
}

function focusableIn(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')]
        .filter(element => !element.hasAttribute('disabled') && element.tabIndex !== -1);
}

function groupAction(items: readonly PlaybookItem[], stateOf: (item: PlaybookItem) => PlaybookRowState): 'select' | 'clear' | 'none' {
    const states = items.map(stateOf);
    if (states.some(state => state === 'open')) return 'select';
    if (states.some(state => state === 'chosen')) return 'clear';
    return 'none';
}

function SelectControl({
    target,
    items,
    busy,
    action,
    onSelect,
}: {
    target: string;
    items: readonly PlaybookItem[];
    busy: boolean;
    action: 'select' | 'clear' | 'none';
    onSelect: (items: readonly PlaybookItem[], clear: boolean) => void;
}) {
    if (items.length === 0) return null;
    return (
        <button
            type="button"
            data-playbook-select={target}
            data-playbook-select-mode={action}
            disabled={busy || action === 'none'}
            onClick={() => onSelect(items, action === 'clear')}
            className="shrink-0 text-[12px] font-medium text-[#ec4899] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:text-[#a1a1aa] disabled:no-underline"
        >
            {action === 'clear' ? PLAYBOOK_COPY.clear : PLAYBOOK_COPY.selectAll}
        </button>
    );
}
