/**
 * Staff edits for client_brand_terms.
 *
 * The table, generated normalized_key, kind check, and org RLS already exist.
 * Writes use the signed-in browser client. The keyword-tracking flag gates
 * every call, so a hidden Rankings tab does not touch Supabase.
 */

import { createClient } from '../supabase/client';
import {
    brandTermIssue,
    cleanBrandTerm,
    isBrandTermKind,
    type BrandTermKind,
} from './brand';
import { keywordTrackingEnabled } from './flag';
import { normalizeTrackerQuery } from '../search-reporting/tracker';

export interface BrandTerm {
    id: string;
    term: string;
    kind: BrandTermKind;
    normalizedKey: string;
}

export type BrandTermList =
    | { ok: true; terms: BrandTerm[] }
    | { ok: false; terms: []; error: string };

export interface BrandTermWriteResult {
    ok: boolean;
    message: string;
}

interface BrandResult {
    data: unknown;
    error: { code?: string } | null;
}

interface BrandRead {
    eq(column: string, value: unknown): BrandRead;
    order(column: string, options?: { ascending?: boolean }): BrandRead;
    range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>;
}

interface BrandWrite extends PromiseLike<BrandResult> {
    eq(column: string, value: unknown): BrandWrite;
    select(columns: string): BrandWrite;
}

export interface BrandTermClient {
    from(table: string): {
        select(columns: string): BrandRead;
        insert(row: Record<string, unknown>): BrandWrite;
        update(row: Record<string, unknown>): BrandWrite;
        delete(): BrandWrite;
    };
}

const PAGE_SIZE = 1000;
const MAX_TERMS = 1000;

function unavailable(): BrandTermWriteResult {
    return { ok: false, message: 'Brand terms are unavailable.' };
}

function errorCode(error: unknown): string {
    if (!error || typeof error !== 'object' || !('code' in error)) return '';
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : '';
}

function writeMessage(error: unknown, fallback: string): string {
    const code = errorCode(error);
    if (code === '23505') return 'That term is already in the list.';
    if (code === '23514') return 'That term is not valid.';
    return fallback;
}

function rowToTerm(row: unknown): BrandTerm | null {
    if (!row || typeof row !== 'object') return null;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.term !== 'string' || typeof record.kind !== 'string') return null;
    if (!isBrandTermKind(record.kind)) return null;
    const normalizedKey = typeof record.normalized_key === 'string' && record.normalized_key
        ? record.normalized_key
        : normalizeTrackerQuery(record.term);
    if (!normalizedKey) return null;
    return { id: record.id, term: record.term, kind: record.kind, normalizedKey };
}

async function readTerms(client: BrandTermClient, organizationId: string, clientId: string): Promise<BrandTerm[]> {
    const { data, error } = await client
        .from('client_brand_terms')
        .select('id, term, kind, normalized_key')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .order('term', { ascending: true })
        .range(0, PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data) || data.length >= MAX_TERMS) throw new Error('Unable to read brand terms');
    const terms: BrandTerm[] = [];
    for (const row of data) {
        const term = rowToTerm(row);
        if (!term) throw new Error('Unable to read brand terms');
        terms.push(term);
    }
    return terms;
}

function browserClient(client: BrandTermClient | null | undefined): BrandTermClient | null {
    if (client !== undefined) return client;
    return (createClient() as unknown as BrandTermClient | undefined) ?? null;
}

export async function loadBrandTerms(input: {
    organizationId: string;
    clientId: string;
    /** Injected in tests. Omitted uses the signed-in browser client. */
    client?: BrandTermClient | null;
}): Promise<BrandTermList> {
    if (!keywordTrackingEnabled()) return { ok: true, terms: [] };
    const supabase = browserClient(input.client);
    if (!supabase) return { ok: false, terms: [], error: 'Brand terms are unavailable.' };
    try {
        const terms = await readTerms(supabase, input.organizationId, input.clientId);
        return { ok: true, terms };
    } catch {
        console.error('Could not read brand terms.');
        return { ok: false, terms: [], error: 'Could not read brand terms.' };
    }
}

export async function addBrandTerm(input: {
    organizationId: string;
    clientId: string;
    term: string;
    kind: string;
    client?: BrandTermClient | null;
}): Promise<BrandTermWriteResult> {
    if (!keywordTrackingEnabled()) return unavailable();
    const issue = brandTermIssue(input.term, input.kind);
    if (issue) return { ok: false, message: issue };
    const supabase = browserClient(input.client);
    if (!supabase) return unavailable();
    try {
        const { error } = await supabase
            .from('client_brand_terms')
            .insert({
                organization_id: input.organizationId,
                client_id: input.clientId,
                term: cleanBrandTerm(input.term),
                kind: input.kind,
            });
        if (error) return { ok: false, message: writeMessage(error, 'Could not save that brand term.') };
        return { ok: true, message: 'Added.' };
    } catch {
        console.error('Could not save that brand term.');
        return { ok: false, message: 'Could not save that brand term.' };
    }
}

export async function updateBrandTerm(input: {
    organizationId: string;
    clientId: string;
    id: string;
    term: string;
    kind: string;
    client?: BrandTermClient | null;
}): Promise<BrandTermWriteResult> {
    if (!keywordTrackingEnabled()) return unavailable();
    const issue = brandTermIssue(input.term, input.kind);
    if (issue) return { ok: false, message: issue };
    if (!input.id) return { ok: false, message: 'Could not save that brand term.' };
    const supabase = browserClient(input.client);
    if (!supabase) return unavailable();
    try {
        const { data, error } = await supabase
            .from('client_brand_terms')
            .update({
                term: cleanBrandTerm(input.term),
                kind: input.kind,
                updated_at: new Date().toISOString(),
            })
            .eq('id', input.id)
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .select('id');
        if (error) return { ok: false, message: writeMessage(error, 'Could not save that brand term.') };
        if (!Array.isArray(data) || data.length !== 1) return { ok: false, message: 'Could not save that brand term.' };
        return { ok: true, message: 'Saved.' };
    } catch {
        console.error('Could not save that brand term.');
        return { ok: false, message: 'Could not save that brand term.' };
    }
}

export async function removeBrandTerm(input: {
    organizationId: string;
    clientId: string;
    id: string;
    client?: BrandTermClient | null;
}): Promise<BrandTermWriteResult> {
    if (!keywordTrackingEnabled()) return unavailable();
    if (!input.id) return { ok: false, message: 'Could not remove that brand term.' };
    const supabase = browserClient(input.client);
    if (!supabase) return unavailable();
    try {
        const { data, error } = await supabase
            .from('client_brand_terms')
            .delete()
            .eq('id', input.id)
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .select('id');
        if (error) return { ok: false, message: writeMessage(error, 'Could not remove that brand term.') };
        if (!Array.isArray(data) || data.length !== 1) return { ok: false, message: 'Could not remove that brand term.' };
        return { ok: true, message: 'Removed.' };
    } catch {
        console.error('Could not remove that brand term.');
        return { ok: false, message: 'Could not remove that brand term.' };
    }
}
