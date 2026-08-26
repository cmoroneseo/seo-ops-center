import {
    buildApproval,
    buildBounce,
    buildEntryEdit,
    buildSubmit,
} from './import-transitions.ts';
import type { QueueSourceRow } from './import-queue-route.ts';

type MutationAction = 'edit' | 'submit' | 'approve' | 'bounce';

export type MutationAuthorization =
    | {
        ok: true;
        userId: string;
        organizationId: string;
        isManager: boolean;
    }
    | { ok: false; status: number; error: string };

export interface ImportMutationDependencies {
    authorize(organizationId: string): Promise<MutationAuthorization>;
    loadRows(organizationId: string, ids: string[]): Promise<QueueSourceRow[]>;
    validateClient(organizationId: string, clientId: string): Promise<boolean>;
    applyUpdate(
        organizationId: string,
        ids: string[],
        updates: Record<string, unknown>,
        expectedStatus: string,
        authorizedUserId: string | null,
    ): Promise<number>;
    now(): string;
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

function objectRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function isMutationAction(value: unknown): value is MutationAction {
    return value === 'edit'
        || value === 'submit'
        || value === 'approve'
        || value === 'bounce';
}

function selectedIds(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    if (!value.every(id => typeof id === 'string' && id.length > 0)) return null;
    if (new Set(value).size !== value.length) return null;
    return value;
}

/**
 * Mutation boundary for import-review entries.
 *
 * Authentication resolves the actor and canonical organization. Every row is
 * then resolved and ownership-checked before transition logic or persistence.
 */
export function createImportEntriesPatch(dependencies: ImportMutationDependencies) {
    return async function patchImportEntries(request: Request): Promise<Response> {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Invalid JSON' }, 400);
        }

        const input = objectRecord(body);
        const organizationId = typeof input.organizationId === 'string'
            ? input.organizationId
            : '';
        const action = input.action;
        const ids = selectedIds(input.ids);

        if (!isMutationAction(action)) {
            return json({ error: 'Unknown action' }, 400);
        }
        if (!ids) {
            return json({ error: 'No entries selected' }, 400);
        }

        const member = await dependencies.authorize(organizationId);
        if (!member.ok) {
            return json({ error: member.error }, member.status);
        }

        if ((action === 'approve' || action === 'bounce') && !member.isManager) {
            return json({ error: 'Forbidden' }, 403);
        }

        const rows = await dependencies.loadRows(member.organizationId, ids);
        const resolvedIds = new Set(rows.map(row => row.id));
        if (rows.length !== ids.length || ids.some(id => !resolvedIds.has(id))) {
            return json({ error: 'Some entries are not in review' }, 404);
        }

        if (!member.isManager && rows.some(row => row.userId !== member.userId)) {
            return json({ error: 'Forbidden' }, 403);
        }

        const actor = { userId: member.userId, isManager: member.isManager };
        const authorizedUserId = member.isManager ? null : member.userId;
        const now = dependencies.now();

        if (action === 'edit') {
            if (rows.length !== 1) {
                return json({ error: 'Edit one entry at a time' }, 400);
            }

            const edit = objectRecord(input.edit);
            const clientId = typeof edit.clientId === 'string' && edit.clientId
                ? edit.clientId
                : null;
            if (clientId && !await dependencies.validateClient(member.organizationId, clientId)) {
                return json({ error: 'Client not found' }, 404);
            }

            const result = buildEntryEdit(rows[0], {
                activityKey: typeof edit.activityKey === 'string' ? edit.activityKey : '',
                detail: typeof edit.detail === 'string' ? edit.detail : '',
                clientId,
                countsTowardBudget: typeof edit.countsTowardBudget === 'boolean'
                    ? edit.countsTowardBudget
                    : undefined,
            }, actor);
            if (!result.ok) {
                return json({ error: result.error }, result.status);
            }

            const changed = await dependencies.applyUpdate(
                member.organizationId,
                [rows[0].id],
                result.updates,
                rows[0].importStatus,
                authorizedUserId,
            );
            if (changed !== 1) {
                return json({ error: 'Entries changed during review' }, 409);
            }
            return json({ ok: true, changed });
        }

        const result = action === 'submit'
            ? buildSubmit(rows, actor, now)
            : action === 'approve'
                ? buildApproval(rows, actor, now)
                : buildBounce(
                    rows,
                    actor,
                    now,
                    typeof input.note === 'string' ? input.note : '',
                );

        if (!result.ok) {
            return json({ error: result.error }, result.status);
        }

        const expectedStatus = action === 'submit' ? 'needs_context' : 'pending_review';
        const changed = await dependencies.applyUpdate(
            member.organizationId,
            result.ids,
            result.updates,
            expectedStatus,
            authorizedUserId,
        );
        if (changed !== result.ids.length) {
            return json({ error: 'Entries changed during review' }, 409);
        }
        return json({ ok: true, action, changed });
    };
}
