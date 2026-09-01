import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerEvent } from '../types.ts';
import { eventToTaskDraft } from './event-to-task.ts';

const event: PlannerEvent = {
    id: 'event-1',
    organizationId: 'org-1',
    userId: 'user-1',
    title: 'Ecoworkz SEO (Content Optimization)',
    description: 'Optimize the priority service pages.',
    kind: 'event',
    startsAt: '2026-08-31T17:30:00.000Z',
    endsAt: '2026-08-31T20:30:00.000Z',
    allDay: false,
    clientId: 'client-1',
    attendeeIds: [],
    busy: true,
    visibility: 'private',
    createdAt: '2026-08-30T12:00:00.000Z',
    updatedAt: '2026-08-30T12:00:00.000Z',
};

test('event conversion preserves work context but creates an unscheduled task draft', () => {
    assert.deepEqual(eventToTaskDraft(event, 'Ecoworkz', 'America/Los_Angeles'), {
        eventId: 'event-1',
        eventUserId: 'user-1',
        startsAt: '2026-08-31T17:30:00.000Z',
        endsAt: '2026-08-31T20:30:00.000Z',
        title: 'Ecoworkz SEO (Content Optimization)',
        description: 'Optimize the priority service pages.',
        clientId: 'client-1',
        clientName: 'Ecoworkz',
        dueDate: '2026-08-31',
    });
});

test('event conversion never carries a calendar start or duration into the new task', () => {
    const draft = eventToTaskDraft(event, 'Ecoworkz', 'America/Los_Angeles');

    assert.equal('startDate' in draft, false);
    assert.equal('scheduledMinutes' in draft, false);
});
