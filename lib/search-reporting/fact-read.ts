/**
 * Chunked reads of gsc_history_facts.
 *
 * The table is ~1.3M rows. Its useful index is UNIQUE (day_id, grain, row_key).
 * One request for every grain and every day in a window sorts by the primary
 * key and times out (57014). Each request here is one grain and a short day
 * list so that index can serve it, then pages with range headers.
 */

import type { SearchQuery, SearchReportingAdmin } from './load';

/** Light grains (property totals, devices) stay in two-week slices. */
export const LIGHT_DAY_CHUNK = 14;
/** query/page rows are the bulk of the heap, so they stay in week-sized slices. */
export const HEAVY_DAY_CHUNK = 7;
export const HEAVY_FACT_GRAINS = new Set(['query_page', 'page', 'page_device']);

const PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 25;
const READ_CONCURRENCY = 4;

export function chunkList<T>(values: readonly T[], size: number): T[][] {
    if (!Number.isInteger(size) || size < 1) throw new Error('Invalid chunk size');
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
    return chunks;
}

export function insightFactGrains(device: string | null | undefined): string[] {
    if (device) return ['page_organic', 'property_device', 'page_device'];
    return ['property', 'page', 'page_organic', 'property_device', 'page_device', 'query_page'];
}

export function chunkSizeForGrain(grain: string): number {
    return HEAVY_FACT_GRAINS.has(grain) ? HEAVY_DAY_CHUNK : LIGHT_DAY_CHUNK;
}

interface FactPage {
    rows: Record<string, unknown>[];
    truncated: boolean;
}

async function readFactPages(build: () => SearchQuery, maxPages: number): Promise<FactPage> {
    const rows: Record<string, unknown>[] = [];
    for (let page = 0; page < maxPages; page += 1) {
        const from = page * PAGE_SIZE;
        const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error('Unable to read Search Console history');
        const batch = (data ?? []) as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) return { rows, truncated: false };
    }
    return { rows, truncated: true };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
    if (items.length === 0) return [];
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await run(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}

export async function readGrainedFacts(
    admin: SearchReportingAdmin,
    input: {
        dayIds: readonly string[];
        grains: readonly string[];
        columns: string;
        maxPages?: number;
    },
): Promise<{ rows: Record<string, unknown>[]; failedGrains: string[] }> {
    const dayIds = [...new Set(input.dayIds.filter(id => typeof id === 'string' && id.length > 0))];
    const grains = [...new Set(input.grains)];
    if (dayIds.length === 0 || grains.length === 0) return { rows: [], failedGrains: [] };
    const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;

    const jobs = grains.flatMap(grain => chunkList(dayIds, chunkSizeForGrain(grain)).map(chunk => ({ grain, chunk })));
    const pages = await mapLimit(jobs, READ_CONCURRENCY, async (job) => {
        try {
            const page = await readFactPages(() => admin.from('gsc_history_facts')
                .select(input.columns)
                .in('day_id', job.chunk)
                .in('grain', [job.grain])
                .order('day_id', { ascending: true })
                .order('id', { ascending: true }), maxPages);
            return page.truncated ? null : page.rows;
        } catch {
            return null;
        }
    });

    const failed = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    const kept = new Map<string, Record<string, unknown>[]>();
    jobs.forEach((job, index) => {
        const page = pages[index];
        if (page == null) {
            failed.add(job.grain);
            return;
        }
        const list = kept.get(job.grain) ?? [];
        list.push(...page);
        kept.set(job.grain, list);
    });
    for (const grain of grains) {
        if (failed.has(grain)) continue;
        rows.push(...(kept.get(grain) ?? []));
    }
    return { rows, failedGrains: [...failed] };
}
