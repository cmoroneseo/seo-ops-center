import type { PlannerEvent } from '../types';

export interface EventTaskDraft {
    eventId: string;
    eventUserId: string;
    startsAt: string;
    endsAt: string;
    title: string;
    description?: string;
    clientId?: string;
    clientName?: string;
    dueDate: string;
    assigneeIds?: string[];
}

/**
 * Copy event context into a task without copying its calendar placement.
 * The event stays intact and the new task begins in Backlog, avoiding a second
 * block over the same time range.
 */
export function eventToTaskDraft(
    event: PlannerEvent,
    clientName?: string,
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
): EventTaskDraft {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(event.startsAt));
    const value = (type: Intl.DateTimeFormatPartTypes) => (
        parts.find(part => part.type === type)?.value ?? ''
    );

    return {
        eventId: event.id,
        eventUserId: event.userId,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        title: event.title,
        ...(event.description ? { description: event.description } : {}),
        ...(event.clientId ? { clientId: event.clientId } : {}),
        ...(clientName ? { clientName } : {}),
        dueDate: `${value('year')}-${value('month')}-${value('day')}`,
        ...(event.attendeeIds.length > 0 ? { assigneeIds: event.attendeeIds } : {}),
    };
}
