import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBasecampTodo, isBasecampConfigured, listBasecampTodolistGroups, listBasecampTodoSteps } from '@/lib/basecamp/api';
import { createBasecampImportTasksPost } from '@/lib/basecamp/import-tasks-route';
import { containedIdsFromBasecampGroups, type OnboardingListScope } from '@/lib/basecamp/import-stage';
import { readBasecampPlanLists } from '@/lib/basecamp/plan-lists';
import { normalizeJsonObject } from '@/lib/basecamp/project-access';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { findImportedBasecampRecordings, membersByBasecampPersonId } from '@/lib/supabase/timesheet-imports';

export const dynamic = 'force-dynamic';

/** POST /api/integrations/basecamp/import-tasks */
export async function POST(req: NextRequest) {
    const post = createBasecampImportTasksPost({
        authorizeClient: (clientId, organizationId) => (
            requireClientOrgMember(clientId, organizationId)
        ),
        createAccessSource: () => createSupabaseBasecampProjectAccessSource(createAdminClient()),
        isConfigured: isBasecampConfigured,
        getTodo: (projectId, todoId) => getBasecampTodo(projectId, todoId),
        getSteps: (projectId, todoId) => listBasecampTodoSteps(projectId, todoId),
        createWriter() {
            const admin = createAdminClient();
            return {
                async insertTasks(rows) {
                    const { error } = await admin.from('tasks').insert(rows);
                    return error?.message ?? null;
                },
                async logCompletions(payload) {
                    // One event per finished to-do, dated when it was
                    // finished — not when the import ran.
                    for (const completion of payload.completions) {
                        await logClientActivity({
                            organizationId: payload.organizationId,
                            clientId: payload.clientId,
                            eventType: 'task.completed',
                            actorId: payload.actorId,
                            actorName: payload.actorName,
                            occurredAt: completion.completedAt,
                            metadata: { title: completion.title, source: 'basecamp_import' },
                        });
                    }
                },
                findRecordings: (organizationId, clientId, recordingIds) => (
                    findImportedBasecampRecordings(organizationId, clientId, recordingIds)
                ),
                async logActivity(payload) {
                    await logClientActivity({
                        organizationId: payload.organizationId,
                        clientId: payload.clientId,
                        eventType: 'integration.tasks_imported',
                        actorId: payload.actorId,
                        actorName: payload.actorName,
                        metadata: {
                            service: 'basecamp',
                            imported: payload.imported,
                            errors: payload.errors,
                        },
                    });
                },
            };
        },
        resolveAssignees: membersByBasecampPersonId,
        async loadOnboardingScope(organizationId, clientId): Promise<OnboardingListScope> {
            const admin = createAdminClient();
            const { data, error } = await admin
                .from('clients')
                .select('custom_fields')
                .eq('id', clientId)
                .eq('organization_id', organizationId)
                .maybeSingle();
            if (error || !data) return { onboardingTodolistId: '', containedIds: [] };
            const lists = readBasecampPlanLists(normalizeJsonObject(data.custom_fields));
            if (!lists.onboardingTodolistId) return { onboardingTodolistId: '', containedIds: [] };
            const groups = lists.projectId
                ? await listBasecampTodolistGroups(lists.projectId, lists.onboardingTodolistId)
                : [];
            return {
                onboardingTodolistId: lists.onboardingTodolistId,
                containedIds: containedIdsFromBasecampGroups(groups)
                    .filter(id => id !== lists.onboardingTodolistId),
            };
        },
        async maxOnboardingPosition(organizationId, clientId) {
            const admin = createAdminClient();
            const { data, error } = await admin
                .from('tasks')
                .select('position')
                .eq('organization_id', organizationId)
                .eq('client_id', clientId)
                .eq('stage', 'onboarding')
                .is('parent_task_id', null)
                .order('position', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) return null;
            const position = data?.position;
            return typeof position === 'number' && Number.isFinite(position) ? position : null;
        },
        now: () => new Date().toISOString(),
    });

    return post(req);
}
