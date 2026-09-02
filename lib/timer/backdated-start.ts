import type { TimerMutationRequest } from './contracts';

export type BackdatedStartResult =
    | { startedAt: string; elapsedMinutes: number }
    | { error: string };

/** Resolve a minute-precision wall-clock time on the user's current local day. */
export function backdatedStartFromTime(
    timeValue: string,
    now: Date = new Date(),
): BackdatedStartResult {
    const match = /^(\d{2}):(\d{2})$/.exec(timeValue);
    if (!match) return { error: 'Choose a valid start time.' };

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59 || Number.isNaN(now.getTime())) {
        return { error: 'Choose a valid start time.' };
    }

    const startedAt = new Date(now);
    startedAt.setHours(hours, minutes, 0, 0);
    const currentMinute = new Date(now);
    currentMinute.setSeconds(0, 0);
    if (startedAt.getTime() >= currentMinute.getTime()) {
        return { error: 'Choose a time earlier than now.' };
    }

    return {
        startedAt: startedAt.toISOString(),
        elapsedMinutes: Math.floor((now.getTime() - startedAt.getTime()) / 60_000),
    };
}

export function defaultBackdatedStartTime(now: Date = new Date()): string {
    const sameDayFloor = new Date(now);
    sameDayFloor.setHours(0, 0, 0, 0);
    const thirtyMinutesEarlier = new Date(now.getTime() - 30 * 60_000);
    const defaultTime = thirtyMinutesEarlier < sameDayFloor ? sameDayFloor : thirtyMinutesEarlier;
    return `${String(defaultTime.getHours()).padStart(2, '0')}:${String(defaultTime.getMinutes()).padStart(2, '0')}`;
}

export function formatBackdatedElapsed(minutes: number): string {
    if (minutes < 1) return 'Less than 1 min already elapsed';
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (hours === 0) return `${minutes} min already elapsed`;
    if (remainder === 0) return `${hours} hr${hours === 1 ? '' : 's'} already elapsed`;
    return `${hours} hr ${remainder} min already elapsed`;
}

export function startTimerMutation(
    taskId: string,
    startedAt?: string,
    timeZone?: string,
): TimerMutationRequest {
    return {
        action: 'start',
        taskId,
        ...(startedAt ? {
            now: startedAt,
            timeZone: timeZone || 'UTC',
        } : {}),
    };
}
