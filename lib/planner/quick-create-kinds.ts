/**
 * What each quick-create type means, beyond which color it draws.
 *
 * "Break" exists because a gap in the day had no vocabulary: an hour away from
 * the desk looked identical to an hour unaccounted for, so the honest answer
 * was harder to record than a fake one. Naming it is the point.
 *
 * Pure: no React, no provider calls.
 */

export type QuickCreateTab = 'event' | 'task' | 'focus' | 'ooo' | 'break';

/**
 * Types that are not work.
 *
 * A break must never carry a client. It closes a visual gap; it is not time
 * anyone delivered, and nothing about it may reach billing or budget.
 */
const NON_WORK: readonly QuickCreateTab[] = ['break'];

/**
 * Titles that make a type one click.
 *
 * A break is recorded to close a gap, and demanding a title first is friction
 * on exactly the action we want people to take rather than skip. Anything
 * typed still wins — "Break" is only the fallback.
 */
const DEFAULT_TITLE: Partial<Record<QuickCreateTab, string>> = { break: 'Break' };

export function isNonWorkTab(tab: QuickCreateTab): boolean {
    return NON_WORK.includes(tab);
}

/** Whether this type may be attributed to a client at all. */
export function carriesClient(tab: QuickCreateTab): boolean {
    return !isNonWorkTab(tab);
}

/** The title to save, or null when this type still requires one. */
export function quickCreateTitle(tab: QuickCreateTab, typed: string): string | null {
    const trimmed = typed.trim();
    if (trimmed) return trimmed;
    return DEFAULT_TITLE[tab] ?? null;
}

/** The client to save against — always absent for non-work. */
export function quickCreateClientId(
    tab: QuickCreateTab,
    selected: string,
): string | undefined {
    if (!carriesClient(tab)) return undefined;
    return selected || undefined;
}
