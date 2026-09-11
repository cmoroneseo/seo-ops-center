import type {
    SearchDismissalReason,
    SearchInvestigation,
    SearchInvestigationEvidenceSnapshot,
    SearchInvestigationKind,
    SearchInvestigationStatusHistoryEntry,
    TaskStatus,
} from '../types';
import { createClient } from './client';

type QueryResult = { data: unknown; error: unknown };
type InvestigationReader = {
    from(table: string): {
        select(columns: string): {
            eq(column: string, value: string): {
                order(column: string, options: { ascending: boolean }): Promise<QueryResult>;
            };
        };
    };
};
type InvestigationRpcClient = {
    rpc(name: string, args: Record<string, unknown>): Promise<QueryResult>;
};

export type SearchInvestigationResult<T> =
    | { success: true; data: T; error?: never }
    | { success: false; data: T; error: string };

export interface SetSearchInvestigationDecisionInput {
    clientId: string;
    property: string;
    kind: SearchInvestigationKind;
    query?: string | null;
    page?: string | null;
    status: 'open' | 'dismissed';
    dismissalReason?: SearchDismissalReason | null;
    dismissalNote?: string | null;
    evidenceSnapshot: SearchInvestigationEvidenceSnapshot;
}

type SearchInvestigationRow = {
    id: string;
    organization_id: string;
    client_id: string;
    property: string;
    kind: SearchInvestigationKind;
    identity_key: string;
    query: string | null;
    page: string | null;
    status: SearchInvestigation['status'];
    task_id: string | null;
    dismissal_reason: SearchDismissalReason | null;
    dismissal_note: string | null;
    evidence_snapshot: SearchInvestigationEvidenceSnapshot;
    status_history: SearchInvestigationStatusHistoryEntry[];
    created_at: string;
    updated_at: string;
    tasks?: { id: string; title: string; status: TaskStatus } | Array<{ id: string; title: string; status: TaskStatus }> | null;
};

export function rowToSearchInvestigation(row: SearchInvestigationRow): SearchInvestigation {
    const task = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        property: row.property,
        kind: row.kind,
        identityKey: row.identity_key,
        query: row.query ?? undefined,
        page: row.page ?? undefined,
        status: row.status,
        taskId: row.task_id ?? undefined,
        linkedTask: task ? { id: task.id, title: task.title, status: task.status } : undefined,
        dismissalReason: row.dismissal_reason ?? undefined,
        dismissalNote: row.dismissal_note ?? undefined,
        evidenceSnapshot: row.evidence_snapshot,
        statusHistory: row.status_history ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export async function getSearchInvestigations(
    clientId: string,
    injectedClient?: InvestigationReader,
): Promise<SearchInvestigationResult<SearchInvestigation[]>> {
    const client = injectedClient ?? createClient() as InvestigationReader | undefined;
    if (!client) {
        return { success: false, data: [], error: 'Unable to load investigation decisions.' };
    }
    try {
        const { data, error } = await client
            .from('search_investigations')
            .select('*, tasks(id,title,status)')
            .eq('client_id', clientId)
            .order('updated_at', { ascending: false });
        if (error) throw error;
        return {
            success: true,
            data: ((data ?? []) as SearchInvestigationRow[]).map(rowToSearchInvestigation),
        };
    } catch {
        console.error('Unable to fetch search investigations.');
        return { success: false, data: [], error: 'Unable to load investigation decisions.' };
    }
}

export async function setSearchInvestigationDecision(
    input: SetSearchInvestigationDecisionInput,
    injectedClient?: InvestigationRpcClient,
): Promise<SearchInvestigationResult<SearchInvestigation | undefined>> {
    const client = injectedClient ?? createClient() as InvestigationRpcClient | undefined;
    if (!client) {
        return { success: false, data: undefined, error: 'Unable to save this investigation decision.' };
    }
    try {
        const { data, error } = await client.rpc('set_search_investigation_decision', {
            p_client_id: input.clientId,
            p_property: input.property,
            p_kind: input.kind,
            p_query: input.query ?? null,
            p_page: input.page ?? null,
            p_status: input.status,
            p_dismissal_reason: input.dismissalReason ?? null,
            p_dismissal_note: input.dismissalNote ?? null,
            p_evidence_snapshot: input.evidenceSnapshot,
        });
        if (error) throw error;
        if (!data) throw new Error('Decision RPC returned no investigation.');
        return { success: true, data: rowToSearchInvestigation(data as SearchInvestigationRow) };
    } catch {
        console.error('Unable to save a search investigation decision.');
        return { success: false, data: undefined, error: 'Unable to save this investigation decision.' };
    }
}
