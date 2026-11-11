import { botTimerDeleteMessage, botTimerFromRow, type BotTimerClock } from '../timer/bot-display';
import type { StaffControlOutcome } from '../bots/staff-control';
import { createClient } from './client';

const OPEN_BOT_COLUMNS = 'id, organization_id, client_id, task_id, user_id, bot_key_id, status, timer_started_at, billable, counts_toward_budget, clients(name), tasks(title), bot_api_keys(name), time_log_segments(started_at, ended_at)';

async function readOpenBotRows(organizationId: string, withNames: boolean): Promise<BotTimerClock[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const columns = withNames
        ? OPEN_BOT_COLUMNS
        : OPEN_BOT_COLUMNS.replace(', bot_api_keys(name)', '');
    const { data, error } = await supabase
        .from('time_logs')
        .select(columns)
        .eq('organization_id', organizationId)
        .in('status', ['in_progress', 'paused'])
        .not('bot_key_id', 'is', null);
    if (error) throw error;
    const rows: unknown[] = data ?? [];
    return rows
        .map(row => botTimerFromRow(row))
        .filter((timer): timer is BotTimerClock => timer !== null);
}

/** Running and paused bot timers in this organization. Names fall back to "bot" if the key list is hidden. */
export async function getOpenBotTimers(organizationId: string): Promise<BotTimerClock[]> {
    try {
        return await readOpenBotRows(organizationId, true);
    } catch {
        try {
            return await readOpenBotRows(organizationId, false);
        } catch (error) {
            console.error('Error fetching bot timers:', error);
            return [];
        }
    }
}

export async function controlBotTimer(input: {
    action: 'pause' | 'resume' | 'stop';
    timeLogId: string;
    description?: string;
    timeZone?: string;
}): Promise<StaffControlOutcome> {
    const response = await fetch('/api/bots/timer/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => ({})) as StaffControlOutcome;
    if (!payload || typeof payload.ok !== 'boolean') {
        return {
            ok: false,
            capped: false,
            alreadyStopped: false,
            phase: null,
            error: 'Could not update the bot timer.',
        };
    }
    return payload;
}

/**
 * Stop every open bot timer on a task before the task is marked done.
 * A timer that is already stopped is fine. A failed stop leaves the task open.
 */
export async function stopOpenBotTimersForTask(taskId: string): Promise<{ ok: true; capped: boolean } | { ok: false; error: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Time data unavailable' };
    const { data, error } = await supabase
        .from('time_logs')
        .select('id')
        .eq('task_id', taskId)
        .in('status', ['in_progress', 'paused'])
        .not('bot_key_id', 'is', null);
    if (error) return { ok: false, error: 'Could not check the bot timer on this task.' };
    let capped = false;
    for (const row of data ?? []) {
        const id = typeof row.id === 'string' ? row.id : '';
        if (!id) continue;
        const result = await controlBotTimer({
            action: 'stop',
            timeLogId: id,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        });
        if (!result.ok && result.code !== 'timer_not_running') {
            return { ok: false, error: result.error || 'Could not stop the bot timer.' };
        }
        if (result.capped) capped = true;
    }
    return { ok: true, capped };
}

/** Refuse a delete while a bot timer is still open on the task. */
export async function botTimerDeleteBlock(taskId: string): Promise<string | null> {
    const supabase = createClient();
    if (!supabase) return 'Time data unavailable';
    const named = await supabase
        .from('time_logs')
        .select('id, bot_api_keys(name)')
        .eq('task_id', taskId)
        .in('status', ['in_progress', 'paused'])
        .not('bot_key_id', 'is', null);
    if (!named.error) {
        const rows: unknown[] = named.data ?? [];
        const names = rows.map(row => {
            const key = typeof row === 'object' && row !== null
                ? (row as { bot_api_keys?: unknown }).bot_api_keys
                : null;
            const record = Array.isArray(key) ? key[0] : key;
            return record && typeof record === 'object' && typeof (record as { name?: unknown }).name === 'string'
                ? (record as { name: string }).name
                : 'bot';
        });
        return names.length > 0 ? botTimerDeleteMessage(names) : null;
    }
    const plain = await supabase
        .from('time_logs')
        .select('id')
        .eq('task_id', taskId)
        .in('status', ['in_progress', 'paused'])
        .not('bot_key_id', 'is', null);
    if (plain.error) return 'Could not check the bot timer on this task.';
    return (plain.data ?? []).length > 0 ? botTimerDeleteMessage([]) : null;
}
