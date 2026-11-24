import { hoursFromSeconds, timerRunningMs, trimTimerTime, type BotTimerTime, type BotTimerTrimAudit } from '../bots/timer.ts';
import {
    isMissingTrimColumn, TRIM_NEEDS_DATABASE_UPDATE,
    type PausedTrimSource, type StoredBotStretch, type TimerTrimSnapshot,
} from '../bots/timer-trim.ts';

interface Entry extends Omit<TimerTrimSnapshot, 'botKeyId'> {
    botKeyId: string | null;
    createdAt: string;
}

export interface PausedTrimLog extends TimerTrimSnapshot, BotTimerTime {
    stretches: PausedTrimSource['stretches'];
    pausedAt: string;
    trimmedAt: string | null;
    previousSource: PausedTrimSource | null;
    source?: PausedTrimSource;
    segments: StoredBotStretch[];
}

export interface PausedTrimSave {
    time: BotTimerTime;
    source: PausedTrimSource;
    audit: BotTimerTrimAudit;
    description: string;
    elapsedSeconds: number;
    hours: number;
}

interface PausedTrimDeps {
    authenticate(): Promise<{ id: string } | null>;
    findLog(id: string): Promise<Entry | null>;
    membership(organizationId: string, userId: string): Promise<string | null>;
    loadTime(log: Entry & { botKeyId: string }): Promise<PausedTrimLog | null>;
    save(log: PausedTrimLog, input: PausedTrimSave): Promise<boolean>;
    now(): Date;
}

const CHANGED = 'This timer changed while you were editing. Reopen it and try again.';

function error(message: string, status: number) {
    return Response.json({ error: message }, { status });
}

export function createPausedTrimPatch(deps: PausedTrimDeps) {
    return async (request: Request, id: string): Promise<Response> => {
        try {
            const user = await deps.authenticate();
            if (!user) return error('Unauthorized', 401);
            if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) return error('Invalid time entry ID.', 400);

            const entry = await deps.findLog(id);
            if (!entry) return error('Time entry not found.', 404);
            const role = await deps.membership(entry.organizationId, user.id);
            if (role !== 'owner' && role !== 'admin') return error('Forbidden', 403);
            if (entry.status !== 'paused' || !entry.botKeyId) return error('This entry is no longer a paused bot timer.', 409);

            const payload = await request.json().catch(() => null);
            const { hours, description } = payload ?? {};
            if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) {
                return error('Hours must be greater than 0.', 400);
            }
            if (typeof description !== 'string' || description.trim().length > 2000) {
                return error('Enter a description of up to 2,000 characters.', 400);
            }

            const log = await deps.loadTime({ ...entry, botKeyId: entry.botKeyId });
            if (!log) return error(CHANGED, 409);
            const source = {
                stretches: log.source?.stretches ?? log.stretches,
                carriedSeconds: log.source?.carriedSeconds ?? log.carriedSeconds,
                pausedAt: log.source?.pausedAt ?? log.pausedAt,
            };
            const originalMs = timerRunningMs(source);
            const time = trimTimerTime(source, hours, originalMs);
            if (!time) {
                const originalHours = (originalMs / 3_600_000).toLocaleString('en-US', { maximumFractionDigits: 6 });
                return error(`Can't be more than the ${originalHours} h this timer actually ran.`, 422);
            }
            const audit = { fromSeconds: originalMs / 1000, at: deps.now().toISOString(), userId: user.id, botKeyId: null };
            const elapsedSeconds = Math.round(timerRunningMs(time) / 1000);
            const saved = await deps.save(log, {
                time, source, audit, description: description.trim(), elapsedSeconds, hours: hoursFromSeconds(elapsedSeconds),
            });
            if (!saved) return error(CHANGED, 409);
            return Response.json({ status: 'paused' });
        } catch (failure) {
            if (isMissingTrimColumn(failure)) return error(TRIM_NEEDS_DATABASE_UPDATE, 503);
            return error('Unable to save time. Try again.', 500);
        }
    };
}
