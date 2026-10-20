/**
 * Keyboard decisions for the SEO Plan tab.
 *
 * `j`, `k`, Enter, and Escape-to-close-the-panel stay in `planPanelKeyAction`
 * (the side panel). This map adds the rest of the shortcut table and decides
 * which single key wins when a field, preview, or sheet is open.
 * `[` and `]` are the month step from the list header. They live here so the
 * tab has one listener, not a second one.
 */

import { planPanelKeyAction } from './plan-panel';

export const PLAN_KEYMAP = [
    { keys: 'c', label: 'Focus Add task' },
    { keys: '↵', label: 'Save the add line, or open the row' },
    { keys: 'Tab', label: 'Cycle the due chip' },
    { keys: 'Esc', label: 'Close the panel, popover, or preview' },
    { keys: 'j / k', label: 'Next and previous row' },
    { keys: 'x', label: 'Check or uncheck' },
    { keys: 't', label: 'Start or pause the timer' },
    { keys: 'u', label: 'Add or edit the live URL' },
    { keys: '/', label: 'Focus search' },
    { keys: '[ / ]', label: 'Previous and next month' },
    { keys: '→ / ←', label: 'Expand or collapse a pillar' },
    { keys: '?', label: 'Shortcut sheet' },
] as const;

export type PlanKeymapAction =
    | { type: 'move'; taskId: string; panel: boolean }
    | { type: 'open'; taskId: string }
    | { type: 'close' }
    | { type: 'focus-add' }
    | { type: 'focus-search' }
    | { type: 'shift-month'; delta: -1 | 1 }
    | { type: 'check'; taskId: string }
    | { type: 'url'; taskId: string }
    | { type: 'pillar'; taskId: string; expand: boolean }
    | { type: 'timer'; taskId: string }
    | { type: 'help' }
    | { type: 'close-help' }
    | { type: 'clear-search' }
    | { type: 'swallow' }
    | { type: 'none' };

export interface PlanKeymapInput {
    key: string;
    shiftKey?: boolean;
    /** ⌘, Ctrl, or Alt. Those belong to the global timer and search. */
    modified?: boolean;
    /** Focus is in a text field, select, or open menu. */
    blocked: boolean;
    panelOpen: boolean;
    focusedId: string | null;
    visibleIds: readonly string[];
    hasQuery: boolean;
    helpOpen: boolean;
    /** The focused row is a pillar, and whether its subtasks are showing. */
    pillar?: 'expanded' | 'collapsed' | null;
    /** Escape is aimed at the add line, a URL field, or an open menu. */
    escapeOwned?: boolean;
    /** Escape is aimed at the plan search field. */
    inSearch?: boolean;
}

/** Done returns to to do. To do and in progress become done. */
export function planCheckStatus(status: string): 'todo' | 'done' {
    return status === 'done' ? 'todo' : 'done';
}

export function planKeyTarget(target: EventTarget | null): { inSearch: boolean; escapeOwned: boolean } {
    if (!target || typeof target !== 'object' || !('closest' in target)) {
        return { inSearch: false, escapeOwned: false };
    }
    const element = target as Element;
    return {
        inSearch: Boolean(element.closest('[data-plan-search]')),
        escapeOwned: Boolean(element.closest(
            '[data-plan-add-root], [data-live-url], [data-plan-field="live-url"], [data-plan-menu]',
        )),
    };
}

function focusedVisible(input: PlanKeymapInput): string | null {
    if (!input.focusedId) return null;
    return input.visibleIds.includes(input.focusedId) ? input.focusedId : null;
}

function helpKey(input: PlanKeymapInput): boolean {
    return input.key === '?' || (input.key === '/' && Boolean(input.shiftKey));
}

export function planKeymapAction(input: PlanKeymapInput): PlanKeymapAction {
    if (input.modified) return { type: 'none' };

    if (input.helpOpen) {
        if (input.escapeOwned) return { type: 'none' };
        if (input.key === 'Escape' || helpKey(input)) return { type: 'close-help' };
        if (input.key === 'Tab') return { type: 'none' };
        return { type: 'swallow' };
    }

    if (input.key === 'Escape' && input.escapeOwned) return { type: 'none' };
    if (input.key === 'Escape' && input.inSearch) return { type: 'clear-search' };

    const panel = planPanelKeyAction({
        key: input.key,
        blocked: input.blocked,
        panelOpen: input.panelOpen,
        focusedId: input.focusedId,
        visibleIds: input.visibleIds,
    });
    if (panel.type !== 'none') return panel;

    if (input.key === 'Escape') {
        if (input.blocked) return { type: 'none' };
        if (input.hasQuery) return { type: 'clear-search' };
        return { type: 'none' };
    }

    if (input.blocked) return { type: 'none' };

    if (input.key === 'c') return { type: 'focus-add' };
    if (input.key === '/' && !input.shiftKey) return { type: 'focus-search' };
    if (helpKey(input)) return { type: 'help' };
    if (input.key === '[') return { type: 'shift-month', delta: -1 };
    if (input.key === ']') return { type: 'shift-month', delta: 1 };

    const taskId = focusedVisible(input);
    if (!taskId) return { type: 'none' };
    if (input.key === 'x') return { type: 'check', taskId };
    if (input.key === 'u') return { type: 'url', taskId };
    if (input.key === 't') return { type: 'timer', taskId };
    if (input.key === 'ArrowRight' && input.pillar === 'collapsed') {
        return { type: 'pillar', taskId, expand: true };
    }
    if (input.key === 'ArrowLeft' && input.pillar === 'expanded') {
        return { type: 'pillar', taskId, expand: false };
    }
    return { type: 'none' };
}
