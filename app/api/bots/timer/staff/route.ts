import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { liveBotDeps } from '@/lib/bots/live';
import { runBotTimerControl } from '@/lib/bots/handle';
import { parseStaffControl, staffControlOutcome, staffTimerRoleDecision } from '@/lib/bots/staff-control';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bots/timer/staff
 * The organization owner pauses, resumes, or stops one bot timer.
 * A bot key is not accepted here. Other members get 403.
 * The write uses the same close path as the bot API.
 */
export async function POST(request: Request) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) {
                    cookieStore.set({ name, value, ...options });
                },
                remove(name: string, options: CookieOptions) {
                    cookieStore.set({ name, value: '', ...options });
                },
            },
        },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Sign in to change a bot timer.' }, { status: 401 });

    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ ok: false, error: 'Send a JSON object.' }, { status: 400 });
    }
    const parsed = parseStaffControl(payload);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    const { data: row, error } = await supabase
        .from('time_logs')
        .select('id, organization_id, bot_key_id')
        .eq('id', parsed.input.timeLogId)
        .maybeSingle();
    if (error || !row) {
        return NextResponse.json({ ok: false, code: 'timer_not_running', error: 'This bot timer is not running or paused.' }, { status: 404 });
    }
    if (!row.bot_key_id) {
        return NextResponse.json({ ok: false, code: 'not_a_bot_timer', error: 'That timer belongs to a person. Use the timer controls for it.' }, { status: 404 });
    }

    const member = await requireOrganizationMember(row.organization_id);
    if (!member.ok) {
        return NextResponse.json({ ok: false, error: member.error }, { status: member.status });
    }
    const decision = staffTimerRoleDecision(member.role);
    if (!decision.ok) {
        return NextResponse.json({ ok: false, code: decision.code, error: decision.error }, { status: decision.status });
    }

    try {
        const result = await runBotTimerControl(liveBotDeps(), parsed.input);
        const outcome = staffControlOutcome(result.status, result.body);
        return NextResponse.json(outcome, { status: result.status });
    } catch {
        return NextResponse.json({ ok: false, error: 'Could not update the bot timer.' }, { status: 500 });
    }
}
