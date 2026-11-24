import { hoursFromSeconds, timerRunningMs, trimTimerTime, type BotTimerTime, type BotTimerTrimAudit } from '../bots/timer.ts';
import type { BotTimerSnapshot, PausedTrimSource } from '../bots/timer-store.ts';

interface PausedTrimLog extends Omit<BotTimerSnapshot, 'botKeyId'>, BotTimerTime {
    botKeyId: string | null;
    status: string;
    pausedAt: string;
    source?: PausedTrimSource;
}

interface PausedTrimDeps {
    authenticate(): Promise<{ id: string } | null>;
    findLog(id: string): Promise<PausedTrimLog | null>;
    membership(organizationId: string, userId: string): Promise<string | null>;
    save(log: PausedTrimLog & { botKeyId: string }, input: {
        time: BotTimerTime;
        source: PausedTrimSource;
        audit: BotTimerTrimAudit;
        description: string;
        elapsedSeconds: number;
        hours: number;
    }): Promise<boolean>;
    now(): Date;
}

function error(message: string, status: number) {
    return Response.json({ error: message }, { status });
}

export function createPausedTrimPatch(deps: PausedTrimDeps) {
    return async (request: Request, id: string): Promise<Response> => {
        try {
            const user = await deps.authenticate();
            if (!user) return error('Unauthorized', 401);
            if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) return error('Invalid time entry ID.', 400);

            const log = await deps.findLog(id);
            if (!log) return error('Time entry not found.', 404);
            const role = await deps.membership(log.organizationId, user.id);
            if (role !== 'owner' && role !== 'admin') return error('Forbidden', 403);
            if (log.status !== 'paused' || !log.botKeyId) return error('This entry is no longer a paused bot timer.', 409);

            const payload = await request.json().catch(() => null);
            const { hours, description } = payload ?? {};
            if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) {
                return error('Hours must be greater than 0.', 400);
            }
            if (typeof description !== 'string' || description.trim().length > 2000) {
                return error('Enter a description of up to 2,000 characters.', 400);
            }

            const source = log.source ?? {
                stretches: log.stretches,
                carriedSeconds: log.carriedSeconds,
                pausedAt: log.pausedAt,
            };
            const originalMs = timerRunningMs(source);
            const time = trimTimerTime(source, hours, originalMs);
            if (!time) {
                const originalHours = (originalMs / 3_600_000).toLocaleString('en-US', { maximumFractionDigits: 6 });
                return error(`Can't be more than the ${originalHours} h this timer actually ran.`, 422);
            }
            const audit = { fromSeconds: originalMs / 1000, at: deps.now().toISOString(), userId: user.id, botKeyId: null };
            const elapsedSeconds = Math.round(timerRunningMs(time) / 1000);
            const saved = await deps.save({ ...log, botKeyId: log.botKeyId }, {
                time, source, audit, description: description.trim(), elapsedSeconds, hours: hoursFromSeconds(elapsedSeconds),
            });
            if (!saved) return error('This timer changed while you were editing. Reopen it and try again.', 409);
            return Response.json({ status: 'paused' });
        } catch {
            return error('Unable to save time. Try again.', 500);
        }
    };
}
