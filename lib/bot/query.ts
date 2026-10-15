import { z } from 'zod';

export const BOT_RANGES = ['7d', '28d', '90d'] as const;
export type BotRange = (typeof BOT_RANGES)[number];
export const MAX_BOT_RANGE_DAYS = 400;

const shape = z.object({
    clientId: z.string(),
    start: z.string().optional(),
    end: z.string().optional(),
    range: z.enum(BOT_RANGES).optional(),
    source: z.enum(['stored', 'live']).optional(),
}).strict();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BotQuery {
    clientId: string;
    start: string;
    end: string;
    source: 'stored' | 'live';
    expectedDays: number;
}

export interface QueryIssue {
    path: string;
    message: string;
}

export function parseBotQuery(url: URL, now: Date): { ok: true; query: BotQuery } | { ok: false; issues: QueryIssue[] } {
    const keys = [...url.searchParams.keys()];
    if (new Set(keys).size !== keys.length) {
        return { ok: false, issues: [{ path: 'query', message: 'Invalid value' }] };
    }
    const raw: Record<string, string> = {};
    for (const key of keys) raw[key] = url.searchParams.get(key) ?? '';
    const parsed = shape.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            issues: parsed.error.issues.slice(0, 8).map(issue => ({
                path: issue.path.join('.') || 'query',
                message: issue.code === 'unrecognized_keys' ? 'Unknown parameter' : 'Invalid value',
            })),
        };
    }

    const issues: QueryIssue[] = [];
    const clientId = parsed.data.clientId;
    if (!UUID.test(clientId)) issues.push({ path: 'clientId', message: 'Invalid value' });

    const hasRange = parsed.data.range !== undefined;
    const hasStart = parsed.data.start !== undefined;
    const hasEnd = parsed.data.end !== undefined;
    if (hasRange && (hasStart || hasEnd)) {
        issues.push({ path: 'range', message: 'Invalid value' });
    } else if (!hasRange && (!hasStart || !hasEnd)) {
        issues.push({ path: 'start', message: 'Invalid value' });
    }

    let start = parsed.data.start;
    let end = parsed.data.end;
    if (parsed.data.range) {
        const days = parsed.data.range === '7d' ? 7 : parsed.data.range === '28d' ? 28 : 90;
        end = utcDate(now);
        start = addUtcDays(end, -(days - 1));
    }

    if (start && !isRealDate(start)) issues.push({ path: 'start', message: 'Invalid value' });
    if (end && !isRealDate(end)) issues.push({ path: 'end', message: 'Invalid value' });
    if (issues.length > 0 || !start || !end) return { ok: false, issues };

    const today = utcDate(now);
    const expectedDays = daysInclusive(start, end);
    if (start > end || end > today || expectedDays > MAX_BOT_RANGE_DAYS) {
        return { ok: false, issues: [{ path: 'end', message: 'Invalid value' }] };
    }

    return {
        ok: true,
        query: {
            clientId,
            start,
            end,
            source: parsed.data.source ?? 'stored',
            expectedDays,
        },
    };
}

export function utcDate(now: Date): string {
    return now.toISOString().slice(0, 10);
}

export function addUtcDays(isoDate: string, days: number): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

export function daysInclusive(start: string, end: string): number {
    const a = Date.parse(`${start}T00:00:00Z`);
    const b = Date.parse(`${end}T00:00:00Z`);
    return Math.round((b - a) / 86_400_000) + 1;
}

function isRealDate(iso: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
