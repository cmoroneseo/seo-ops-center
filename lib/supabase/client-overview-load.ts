/**
 * One wave of overview reads. The client row is fetched beside these, not
 * before them, and the change log is in the same wave as hours and tasks.
 */

export interface OverviewPartLoaders<H, F, T, P, M, C> {
    hours: () => Promise<H>;
    fulfillment: () => Promise<F>;
    tasks: () => Promise<T>;
    plan: () => Promise<P>;
    marketingPlan: () => Promise<M>;
    changeLog: () => Promise<C>;
}

export function loadOverviewParts<H, F, T, P, M, C>(
    parts: OverviewPartLoaders<H, F, T, P, M, C>,
): Promise<[H, F, T, P, M, C]> {
    return Promise.all([
        parts.hours(),
        parts.fulfillment(),
        parts.tasks(),
        parts.plan(),
        parts.marketingPlan(),
        parts.changeLog(),
    ]);
}

/** Critical path of the old overview load, kept so the timing test can compare. */
export const OVERVIEW_WAVES_BEFORE = [
    ['clients'],
    ['hours', 'fulfillment', 'tasks', 'plan', 'marketingPlan'],
    ['changeLog'],
] as const;

export const OVERVIEW_WAVES_AFTER = [
    ['client', 'hours', 'fulfillment', 'tasks', 'plan', 'marketingPlan', 'changeLog'],
] as const;

export const DASHBOARD_WAVES_BEFORE = [
    ['clients', 'integrations'],
    ['as_of'],
    ['gsc'],
    ['bing_links'],
    ['bing_aggregate', 'bing_pages'],
    ['ga4_links'],
    ['ga4_aggregate'],
] as const;

export const DASHBOARD_WAVES_AFTER = [
    ['clients', 'integrations', 'as_of'],
    ['gsc', 'bing', 'ga4'],
] as const;

export async function waveLatency(waves: readonly (readonly string[])[], latencyMs: number): Promise<number> {
    const started = performance.now();
    for (const wave of waves) {
        await Promise.all(wave.map(() => new Promise<void>(resolve => {
            setTimeout(resolve, latencyMs);
        })));
    }
    return performance.now() - started;
}
