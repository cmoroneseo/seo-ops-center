'use client';

import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { planKeymapAction, planKeyTarget, type PlanKeymapAction } from '@/lib/seo-plan/plan-keymap';
import { planShortcutBlocked, visiblePlanRowIds, type PlanPanelField } from '@/lib/seo-plan/plan-panel';
import { isPendingStageTaskId } from '@/lib/seo-plan/stage-add';

/**
 * The one key listener for the SEO Plan tab.
 * Month steps, row focus, and the side panel's j/k/Enter/Escape all go through it.
 * `t` starts or pauses the focused row through `onRowTimer`.
 */
export function usePlanKeymap({
    rootRef,
    searchRef,
    query,
    onQueryChange,
    panelOpen,
    focusedId,
    setFocusedId,
    onOpenTask,
    onClosePanel,
    onToggleCheck,
    onRowTimer,
    onShiftMonth,
}: {
    rootRef: RefObject<HTMLElement | null>;
    searchRef: RefObject<HTMLInputElement | null>;
    query: string;
    onQueryChange: (query: string) => void;
    panelOpen: boolean;
    focusedId: string | null;
    setFocusedId: Dispatch<SetStateAction<string | null>>;
    onOpenTask: (taskId: string, field?: PlanPanelField | null) => void;
    onClosePanel?: () => void;
    onToggleCheck?: (taskId: string) => void | Promise<void>;
    onRowTimer?: (taskId: string) => void;
    onShiftMonth: (delta: -1 | 1) => void;
}): { helpOpen: boolean; closeHelp: () => void } {
    const [helpOpen, setHelpOpen] = useState(false);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.isComposing) return;
            if (event.repeat && event.key !== 'j' && event.key !== 'k') return;
            const target = planKeyTarget(event.target);
            const root = rootRef.current;
            const visibleIds = visiblePlanRowIds(root ?? document)
                .filter(id => !isPendingStageTaskId(id));
            const action = planKeymapAction({
                key: event.key,
                shiftKey: event.shiftKey,
                modified: event.metaKey || event.ctrlKey || event.altKey,
                blocked: planShortcutBlocked(event.target, event.key),
                panelOpen,
                focusedId,
                visibleIds,
                hasQuery: query.trim().length > 0,
                helpOpen,
                pillar: pillarState(root, focusedId),
                escapeOwned: target.escapeOwned,
                inSearch: target.inSearch,
            });
            applyPlanKey(action, event, {
                root,
                searchRef,
                setFocusedId,
                onOpenTask,
                onClosePanel,
                onToggleCheck,
                onRowTimer,
                onShiftMonth,
                onQueryChange,
                setHelpOpen,
            });
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [
        focusedId,
        helpOpen,
        onClosePanel,
        onOpenTask,
        onQueryChange,
        onRowTimer,
        onShiftMonth,
        onToggleCheck,
        panelOpen,
        query,
        rootRef,
        searchRef,
        setFocusedId,
    ]);

    return { helpOpen, closeHelp: () => setHelpOpen(false) };
}

function pillarState(root: ParentNode | null, taskId: string | null): 'expanded' | 'collapsed' | null {
    if (!root || !taskId) return null;
    const row = root.querySelector(`[data-plan-row="${cssEscape(taskId)}"]`);
    const button = row?.querySelector('button[aria-expanded]');
    if (!(button instanceof Element)) return null;
    return button.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed';
}

function cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return value.replace(/["\\]/g, '\\$&');
}

function applyPlanKey(
    action: PlanKeymapAction,
    event: KeyboardEvent,
    handlers: {
        root: HTMLElement | null;
        searchRef: RefObject<HTMLInputElement | null>;
        setFocusedId: Dispatch<SetStateAction<string | null>>;
        onOpenTask: (taskId: string, field?: PlanPanelField | null) => void;
        onClosePanel?: () => void;
        onToggleCheck?: (taskId: string) => void | Promise<void>;
        onRowTimer?: (taskId: string) => void;
        onShiftMonth: (delta: -1 | 1) => void;
        onQueryChange: (query: string) => void;
        setHelpOpen: Dispatch<SetStateAction<boolean>>;
    },
) {
    if (action.type === 'none') return;
    if (action.type === 'swallow') {
        event.preventDefault();
        return;
    }
    event.preventDefault();
    switch (action.type) {
        case 'focus-add': {
            const add = handlers.root?.querySelector('[data-plan-add]');
            if (add instanceof HTMLElement) add.focus();
            return;
        }
        case 'focus-search':
            handlers.searchRef.current?.focus();
            return;
        case 'shift-month':
            handlers.onShiftMonth(action.delta);
            return;
        case 'move':
            handlers.setFocusedId(action.taskId);
            if (action.panel) handlers.onOpenTask(action.taskId, null);
            scrollRow(handlers.root, action.taskId);
            return;
        case 'open':
            handlers.setFocusedId(action.taskId);
            handlers.onOpenTask(action.taskId, null);
            return;
        case 'close':
            handlers.onClosePanel?.();
            return;
        case 'check':
            void handlers.onToggleCheck?.(action.taskId);
            return;
        case 'url':
            editRowUrl(handlers.root, action.taskId);
            return;
        case 'pillar':
            togglePillar(handlers.root, action.taskId);
            return;
        case 'timer':
            handlers.onRowTimer?.(action.taskId);
            return;
        case 'help':
            handlers.setHelpOpen(true);
            return;
        case 'close-help':
            handlers.setHelpOpen(false);
            return;
        case 'clear-search':
            handlers.onQueryChange('');
            handlers.searchRef.current?.blur();
            return;
        default:
            return;
    }
}

function scrollRow(root: ParentNode | null, taskId: string) {
    const row = root?.querySelector(`[data-plan-row="${cssEscape(taskId)}"]`);
    if (!(row instanceof HTMLElement) || typeof row.scrollIntoView !== 'function') return;
    try {
        row.scrollIntoView({ block: 'nearest' });
    } catch {
        // jsdom does not implement scrollIntoView with options.
    }
}

function editRowUrl(root: ParentNode | null, taskId: string) {
    const row = root?.querySelector(`[data-plan-row="${cssEscape(taskId)}"]`);
    if (!(row instanceof Element)) return;
    const editor = row.querySelector('input[aria-label="Live URL"], input[aria-label="Edit live URL"]');
    if (editor instanceof HTMLElement) {
        editor.focus();
        return;
    }
    const button = row.querySelector('[data-add-live-url]');
    if (button instanceof HTMLElement) button.click();
}

function togglePillar(root: ParentNode | null, taskId: string) {
    const row = root?.querySelector(`[data-plan-row="${cssEscape(taskId)}"]`);
    const button = row?.querySelector('button[aria-expanded]');
    if (button instanceof HTMLElement) button.click();
}
