import type { TopicalMapRecord } from '../types';
import { parseScheduledFor, type SpecFieldPatch } from './spec';

/**
 * Spec text is saved on blur and when the drawer closes, never on a keystroke.
 * A date is saved from the input's value on change and on blur.
 * Responses apply only the fields that request sent, and only if the user
 * has not edited them since the request started. That is what keeps a slow
 * status save from writing unique_angle back to null.
 */

export const SPEC_SAVE_FIELDS = [
    'targetQuery',
    'wordCountMin',
    'wordCountMax',
    'answerFirst60',
    'uniqueAngle',
    'scheduledFor',
    'specStatus',
    'scopeExclusions',
    'outgoingLinks',
] as const;

export type SpecSaveField = typeof SPEC_SAVE_FIELDS[number];
export type FieldRevisions = Partial<Record<SpecSaveField, number>>;
export type SpecSaveState = 'idle' | 'saving' | 'saved' | 'error';
export type TextSpecField = 'targetQuery' | 'answerFirst60' | 'uniqueAngle';

export function specSaveLabel(state: SpecSaveState): string {
    if (state === 'saving') return 'Saving…';
    if (state === 'saved') return 'Saved';
    return '';
}

export function pickSpecFields(partial: object): SpecFieldPatch | null {
    const source = partial as Record<string, unknown>;
    const patch: SpecFieldPatch = {};
    let any = false;
    for (const key of SPEC_SAVE_FIELDS) {
        if (!(key in source)) continue;
        (patch as Record<string, unknown>)[key] = source[key];
        any = true;
    }
    return any ? patch : null;
}

export function specBaseline(record: TopicalMapRecord): SpecFieldPatch {
    return {
        targetQuery: record.targetQuery,
        wordCountMin: record.wordCountMin > 0 ? record.wordCountMin : null,
        wordCountMax: record.wordCountMax > 0 ? record.wordCountMax : null,
        answerFirst60: record.answerFirst60 ?? null,
        uniqueAngle: record.uniqueAngle ?? null,
        scheduledFor: record.scheduledFor ?? null,
        specStatus: record.specStatus ?? null,
        scopeExclusions: record.scopeExclusions,
        outgoingLinks: record.outgoingLinks,
    };
}

export function bumpRevisions(current: FieldRevisions, patch: SpecFieldPatch): FieldRevisions {
    const next = { ...current };
    for (const key of SPEC_SAVE_FIELDS) {
        if (key in patch) next[key] = (next[key] ?? 0) + 1;
    }
    return next;
}

export function snapshotRevisions(current: FieldRevisions, patch: SpecFieldPatch): FieldRevisions {
    const shot: FieldRevisions = {};
    for (const key of SPEC_SAVE_FIELDS) {
        if (key in patch) shot[key] = current[key] ?? 0;
    }
    return shot;
}

function normalizeField(key: SpecSaveField, value: unknown): string {
    if (key === 'scopeExclusions' || key === 'outgoingLinks') return JSON.stringify(value ?? []);
    if (key === 'wordCountMin' || key === 'wordCountMax') {
        const numeric = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : '';
    }
    if (typeof value === 'string') return value.trim();
    if (value == null) return '';
    return String(value);
}

export function changedSpecPatch(local: SpecFieldPatch, saved: SpecFieldPatch): SpecFieldPatch | null {
    const patch: SpecFieldPatch = {};
    let any = false;
    for (const key of SPEC_SAVE_FIELDS) {
        if (!(key in local)) continue;
        if (normalizeField(key, local[key]) === normalizeField(key, saved[key])) continue;
        (patch as Record<string, unknown>)[key] = local[key];
        any = true;
    }
    return any ? patch : null;
}

export function specPatchKey(patch: SpecFieldPatch): string {
    return SPEC_SAVE_FIELDS
        .filter(key => key in patch)
        .map(key => `${key}:${normalizeField(key, patch[key])}`)
        .join('|');
}

export function mergeSpecSave(
    local: TopicalMapRecord,
    server: TopicalMapRecord,
    sent: SpecFieldPatch,
    sentRevisions: FieldRevisions,
    currentRevisions: FieldRevisions,
): TopicalMapRecord {
    const next: TopicalMapRecord = { ...local, updatedAt: server.updatedAt };
    if (server.source) next.source = server.source;
    for (const key of SPEC_SAVE_FIELDS) {
        if (!(key in sent)) continue;
        if ((currentRevisions[key] ?? 0) !== (sentRevisions[key] ?? 0)) continue;
        (next as unknown as Record<string, unknown>)[key] = server[key];
    }
    return next;
}

export function advanceBaseline(
    saved: SpecFieldPatch,
    merged: TopicalMapRecord,
    sent: SpecFieldPatch,
    sentRevisions: FieldRevisions,
    currentRevisions: FieldRevisions,
): SpecFieldPatch {
    const next = { ...saved };
    const baseline = specBaseline(merged);
    for (const key of SPEC_SAVE_FIELDS) {
        if (!(key in sent)) continue;
        if ((currentRevisions[key] ?? 0) !== (sentRevisions[key] ?? 0)) continue;
        (next as Record<string, unknown>)[key] = baseline[key];
    }
    return next;
}

export function textFieldPatch(
    event: 'change' | 'blur' | 'close',
    field: TextSpecField,
    value: string,
    saved: string | null | undefined,
): SpecFieldPatch | null {
    if (event === 'change') return null;
    if (value.trim() === (saved ?? '').trim()) return null;
    if (field === 'targetQuery') return { targetQuery: value };
    if (field === 'answerFirst60') return { answerFirst60: value };
    return { uniqueAngle: value };
}

export function dateFieldPatch(
    value: string,
    saved: string | null | undefined,
): { ok: true; patch: SpecFieldPatch | null } | { ok: false; error: string } {
    if (value === (saved ?? '')) return { ok: true, patch: null };
    if (value === '') return { ok: true, patch: { scheduledFor: null } };
    const parsed = parseScheduledFor(value);
    if (!parsed.ok) return parsed;
    if ((parsed.value ?? '') === (saved ?? '')) return { ok: true, patch: null };
    return { ok: true, patch: { scheduledFor: parsed.value } };
}

export function wordRangePatch(minRaw: string, maxRaw: string): SpecFieldPatch {
    const min = minRaw.trim() ? Number(minRaw) : 0;
    const max = maxRaw.trim() ? Number(maxRaw) : 0;
    return {
        wordCountMin: Number.isFinite(min) && min > 0 ? min : null,
        wordCountMax: Number.isFinite(max) && max > 0 ? max : null,
    };
}

export function createSerialQueue() {
    let tail: Promise<void> = Promise.resolve();
    return function enqueue<T>(job: () => Promise<T>): Promise<T> {
        const run = tail.then(job, job);
        tail = run.then(() => undefined, () => undefined);
        return run;
    };
}
