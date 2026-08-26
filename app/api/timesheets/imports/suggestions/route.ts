import { NextRequest, NextResponse } from 'next/server';
import { requireClientOrgMember, requireOrganizationMember } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    suggestionsFor,
    utcDayWindow,
    type CandidateTodo,
} from '@/lib/timesheets/suggestions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timesheets/imports/suggestions?organizationId=&clientId=&date=
 *
 * Completed SEO PM tasks are read-only context for a mapped import row. A
 * client is required and authorized before the task query, so a member cannot
 * use suggestions to browse another client or tenant. The response never
 * changes an import row or its review/approval state.
 */
export async function GET(req: NextRequest) {
    const params = new URL(req.url).searchParams;
    const organizationId = params.get('organizationId')?.trim() ?? '';
    const clientId = params.get('clientId')?.trim() ?? '';
    const date = params.get('date')?.trim() ?? '';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ error: 'date must be yyyy-MM-dd' }, { status: 400 });
    }

    const dayWindow = utcDayWindow(date);
    if (!dayWindow) {
        return NextResponse.json({ error: 'date must be yyyy-MM-dd' }, { status: 400 });
    }

    // An unmapped entry has no safe client context from which to suggest work.
    if (!clientId) {
        const member = await requireOrganizationMember(organizationId);
        if (!member.ok) {
            return NextResponse.json({ error: member.error }, { status: member.status });
        }
        return NextResponse.json({ suggestions: [] });
    }

    const member = await requireClientOrgMember(clientId, organizationId);
    if (!member.ok) {
        return NextResponse.json({ error: member.error }, { status: member.status });
    }

    const { data, error } = await createAdminClient()
        .from('tasks')
        .select('id, title, completed_at')
        .eq('organization_id', member.organizationId)
        .eq('client_id', member.clientId)
        .not('completed_at', 'is', null)
        .gte('completed_at', dayWindow.startsAt)
        .lt('completed_at', dayWindow.endsBefore)
        .limit(20);
    if (error) {
        return NextResponse.json({ error: 'Unable to load suggestions' }, { status: 500 });
    }

    const todos: CandidateTodo[] = (data ?? []).map(task => ({
        title: task.title,
        completedOn: String(task.completed_at).slice(0, 10),
        taskId: task.id,
    }));

    return NextResponse.json({ suggestions: suggestionsFor(todos, { date }) });
}
