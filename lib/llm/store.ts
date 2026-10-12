/**
 * Service-role ledger for llm_calls.
 * Browser clients cannot insert. This module does not log row contents.
 */

import { createAdminClient } from '../supabase/admin.ts';
import { LlmInvalidRequestError, LlmLedgerError } from './errors.ts';
import type { LlmCallDraft, LlmCallStore } from './types.ts';

interface AdminClient {
    from(table: string): {
        select(columns: string): {
            eq(column: string, value: string): {
                eq(column: string, value: string): {
                    maybeSingle(): Promise<{ data: { id: string } | null; error: unknown }>;
                };
                maybeSingle(): Promise<{ data: { llm_monthly_spend_cap_usd: unknown } | null; error: unknown }>;
            };
        };
        insert(row: Record<string, unknown>): {
            select(columns: string): {
                single(): Promise<{ data: { id: string } | null; error: unknown }>;
            };
        };
    };
    rpc(fn: string, args: Record<string, string>): Promise<{ data: unknown; error: unknown }>;
}

function usdFromDb(value: unknown): string {
    if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Number.isInteger(value) ? value.toFixed(2) : value.toFixed(8);
    }
    throw new LlmLedgerError('ledger_read_failed');
}

export function createSupabaseLlmCallStore(admin?: AdminClient): LlmCallStore {
    const db = admin ?? (createAdminClient() as unknown as AdminClient);
    return {
        async getMonthlyCapUsd(organizationId) {
            const { data, error } = await db
                .from('organizations')
                .select('llm_monthly_spend_cap_usd')
                .eq('id', organizationId)
                .maybeSingle();
            if (error) throw new LlmLedgerError('ledger_read_failed');
            if (!data) throw new LlmInvalidRequestError('unknown_organization');
            return usdFromDb(data.llm_monthly_spend_cap_usd);
        },

        async sumMonthSpendUsd(organizationId, monthStart, monthEnd) {
            const { data, error } = await db.rpc('llm_month_spend_usd', {
                p_organization_id: organizationId,
                p_month_start: monthStart.toISOString(),
                p_month_end: monthEnd.toISOString(),
            });
            if (error) throw new LlmLedgerError('ledger_read_failed');
            return usdFromDb(data ?? 0);
        },

        async clientBelongsToOrg(organizationId, clientId) {
            const { data, error } = await db
                .from('clients')
                .select('id')
                .eq('id', clientId)
                .eq('organization_id', organizationId)
                .maybeSingle();
            if (error) throw new LlmLedgerError('ledger_read_failed');
            return data != null;
        },

        async insertCall(row: LlmCallDraft) {
            const { data, error } = await db
                .from('llm_calls')
                .insert({
                    organization_id: row.organizationId,
                    client_id: row.clientId,
                    feature: row.feature,
                    ref_id: row.refId,
                    model: row.model,
                    input_tokens: row.inputTokens,
                    output_tokens: row.outputTokens,
                    cost_usd: row.costUsd,
                    latency_ms: row.latencyMs,
                    status: row.status,
                    error: row.error,
                })
                .select('id')
                .single();
            if (error || !data) throw new LlmLedgerError('ledger_write_failed');
            return { id: data.id };
        },
    };
}
