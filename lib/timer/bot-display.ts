import type { PlanRowTimerPhase, PlanRowTimerView } from '../seo-plan/row-timer.ts';

/** How often the dashboard re-reads open bot timers while the tab is visible. */
export const BOT_TIMER_POLL_MS = 8_000;

export interface BotTimerStretchClock {
    startedAt: string;
    endedAt: string;
}

/**
 * A bot-owned running or paused time entry, as the screen draws it.
 * Closed stretches only. The open stretch is `openStartedAt`, never an open segment.
 */
export interface BotTimerClock {
    id: string;
    taskId: string;
    taskTitle: string;
    clientId?: string;
    clientName?: string;
    botKeyId: string;
    botName: string;
    phase: 'running' | 'paused';
    openStartedAt: string | null;
    stretches: BotTimerStretchClock[];
    billable: boolean;
    countsTowardBudget: boolean;
}

export interface PlanRowBotView extends PlanRowTimerView {
    /** Whose entry the row's main play button drives. */
    owner: 'human' | 'bot' | 'none';
    botTimerId?: string;
    /** `seo-manager bot` when this row is showing a bot timer. */
    botLabel?: string;
    /** Other bot timers on the same task. The floating timer controls those. */
    extraBotLabels: string[];
}

/** `seo-manager bot`. A name that already ends in "bot" is left as written. */
export function botBadgeLabel(botName: string | null | undefined): string {
    const name = (botName ?? '').trim() || 'bot';
    return /\bbot$/i.test(name) ? name : `${name} bot`;
}

function stretchSeconds(stretch: BotTimerStretchClock): number {
    const started = Date.parse(stretch.startedAt);
    const ended = Date.parse(stretch.endedAt);
    if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return 0;
    return (ended - started) / 1000;
}

/** Closed stretches only. Paused gaps are not in the list, so they add nothing. */
export function closedStretchSeconds(stretches: readonly BotTimerStretchClock[]): number {
    return stretches.reduce((sum, stretch) => sum + stretchSeconds(stretch), 0);
}

/**
 * Whole seconds a person would see on the clock.
 * Running time is the closed stretches plus `now - openStartedAt`.
 * A paused timer is the closed stretches only.
 */
export function botTimerElapsedSeconds(
    timer: Pick<BotTimerClock, 'phase' | 'openStartedAt' | 'stretches'>,
    now = new Date(),
): number {
    const closed = closedStretchSeconds(timer.stretches);
    if (timer.phase !== 'running' || !timer.openStartedAt) return Math.round(closed);
    const started = Date.parse(timer.openStartedAt);
    if (!Number.isFinite(started)) return Math.round(closed);
    const open = Math.max(0, now.getTime() - started) / 1000;
    return Math.round(closed + open);
}

/**
 * Hours for the task view while a bot timer is still open.
 * Under an hour this is minutes, so a two-minute run does not read as 0.0h.
 */
export function formatOpenTaskHours(hours: number): string {
    if (!Number.isFinite(hours) || hours <= 0) return '0h';
    if (hours < 1) {
        const minutes = Math.max(1, Math.round(hours * 60));
        return `${minutes}m`;
    }
    return `${Math.round(hours * 10) / 10}h`;
}

/** Hundredths of an hour, the same rounding a stopped bot timer stores. */
export function botTimerHours(
    timer: Pick<BotTimerClock, 'phase' | 'openStartedAt' | 'stretches'>,
    now = new Date(),
): number {
    const seconds = botTimerElapsedSeconds(timer, now);
    if (seconds <= 0) return 0;
    return Math.round((seconds / 3600) * 100) / 100;
}

/**
 * Logged hours plus bot time that is still running or paused.
 * Those rows are not in the logged sum. Do not pass them in `loggedHours`.
 */
export function taskHoursWithBotTimers(
    loggedHours: number,
    timers: readonly Pick<BotTimerClock, 'phase' | 'openStartedAt' | 'stretches'>[],
    now = new Date(),
): number {
    const logged = Number.isFinite(loggedHours) ? loggedHours : 0;
    const extra = timers.reduce((sum, timer) => sum + botTimerHours(timer, now), 0);
    return Math.round((logged + extra) * 100) / 100;
}

function primaryBot(bots: readonly BotTimerClock[]): BotTimerClock | null {
    return bots.find(timer => timer.phase === 'running') ?? bots[0] ?? null;
}

/**
 * The row clock. Carlos's own attempt wins the play button.
 * A bot timer fills that button only when he has nothing open on this task.
 */
export function planRowWithBotTimer(
    human: PlanRowTimerView,
    bots: readonly BotTimerClock[],
    elapsed: (timer: BotTimerClock) => number,
): PlanRowBotView {
    const labels = bots.map(timer => botBadgeLabel(timer.botName));
    if (human.phase !== 'idle') {
        return {
            ...human,
            owner: 'human',
            extraBotLabels: labels,
        };
    }
    const primary = primaryBot(bots);
    if (!primary) {
        return { phase: 'idle', seconds: 0, owner: 'none', extraBotLabels: [] };
    }
    const phase: PlanRowTimerPhase = primary.phase === 'running' ? 'running' : 'paused';
    return {
        phase,
        seconds: elapsed(primary),
        owner: 'bot',
        botTimerId: primary.id,
        botLabel: botBadgeLabel(primary.botName),
        extraBotLabels: bots
            .filter(timer => timer.id !== primary.id)
            .map(timer => botBadgeLabel(timer.botName)),
    };
}

export type RowTimerClick =
    | { action: 'human' }
    | { action: 'pause-bot'; botTimerId: string }
    | { action: 'resume-bot'; botTimerId: string };

/** The row play button. A bot-owned row pauses or resumes that bot and does not start his timer. */
export function rowTimerClick(view: {
    phase: PlanRowTimerPhase;
    owner?: 'human' | 'bot' | 'none';
    botTimerId?: string;
}): RowTimerClick {
    if (view.owner === 'bot' && view.botTimerId) {
        if (view.phase === 'running') return { action: 'pause-bot', botTimerId: view.botTimerId };
        if (view.phase === 'paused') return { action: 'resume-bot', botTimerId: view.botTimerId };
    }
    return { action: 'human' };
}

export function botTimerDeleteMessage(names: readonly string[]): string {
    const labels = names.map(name => botBadgeLabel(name));
    if (labels.length === 0) return 'Stop the bot timer on this task before deleting it.';
    if (labels.length === 1) return `Stop the ${labels[0]} timer before deleting this task.`;
    const last = labels[labels.length - 1];
    return `Stop the ${labels.slice(0, -1).join(', ')} and ${last} timers before deleting this task.`;
}

function objectRow(value: unknown): Record<string, unknown> | null {
    if (Array.isArray(value)) return objectRow(value[0]);
    if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
    return null;
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

/** One open bot row from a `time_logs` select. Human rows and closed rows are ignored. */
export function botTimerFromRow(value: unknown): BotTimerClock | null {
    const row = objectRow(value);
    if (!row) return null;
    const id = text(row.id);
    const taskId = text(row.task_id);
    const botKeyId = text(row.bot_key_id);
    const status = text(row.status);
    if (!id || !taskId || !botKeyId) return null;
    if (status !== 'in_progress' && status !== 'paused') return null;
    const openStartedAt = text(row.timer_started_at);
    if (status === 'in_progress' && !openStartedAt) return null;
    const task = objectRow(row.tasks);
    const client = objectRow(row.clients);
    const key = objectRow(row.bot_api_keys);
    const segmentRows = Array.isArray(row.time_log_segments) ? row.time_log_segments : [];
    const stretches: BotTimerStretchClock[] = [];
    for (const segment of segmentRows) {
        const item = objectRow(segment);
        const startedAt = text(item?.started_at);
        const endedAt = text(item?.ended_at);
        if (!startedAt || !endedAt) continue;
        stretches.push({ startedAt, endedAt });
    }
    stretches.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    return {
        id,
        taskId,
        taskTitle: text(task?.title) ?? 'Task',
        ...(text(row.client_id) ? { clientId: text(row.client_id)! } : {}),
        ...(text(client?.name) ? { clientName: text(client?.name)! } : {}),
        botKeyId,
        botName: text(key?.name) ?? 'bot',
        phase: status === 'paused' ? 'paused' : 'running',
        openStartedAt: status === 'paused' ? null : openStartedAt,
        stretches,
        billable: typeof row.billable === 'boolean' ? row.billable : true,
        countsTowardBudget: typeof row.counts_toward_budget === 'boolean' ? row.counts_toward_budget : true,
    };
}
