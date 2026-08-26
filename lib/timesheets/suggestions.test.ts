import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestionsFor, utcDayWindow, type CandidateTodo } from './suggestions.ts';

const todos: CandidateTodo[] = [
    { title: 'Fix title tags on service pages', completedOn: '2026-08-06', taskId: 'task-1' },
    { title: 'Technical SEO audit for /products', completedOn: '2026-08-06', taskId: 'task-2' },
    { title: 'Write August blog post', completedOn: '2026-08-20', taskId: 'task-3' },
];

test('suggests to-dos completed on the entry date', () => {
    const result = suggestionsFor(todos, { date: '2026-08-06' });

    assert.deepEqual(result.map(s => s.title), [
        'Fix title tags on service pages',
        'Technical SEO audit for /products',
    ]);
});

test('a suggestion carries its task id so the row can link to it', () => {
    const result = suggestionsFor(todos, { date: '2026-08-06' });

    assert.equal(result[0].taskId, 'task-1');
});

test('suggestions guess an activity from the title when it is unambiguous', () => {
    const result = suggestionsFor(todos, { date: '2026-08-06' });

    assert.equal(result[0].activityKey, 'metadata_optimization');
    assert.equal(result[1].activityKey, 'technical_audit');
});

test('a title matching nothing suggests no activity rather than a wrong one', () => {
    const result = suggestionsFor(
        [{ title: 'Misc follow-up', completedOn: '2026-08-06', taskId: 'task-9' }],
        { date: '2026-08-06' },
    );

    assert.equal(result[0].activityKey, null);
});

test('a date with no completed to-dos suggests nothing', () => {
    assert.deepEqual(suggestionsFor(todos, { date: '2026-08-07' }), []);
});

test('suggestions are capped so the row stays readable', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
        title: `Task ${index}`, completedOn: '2026-08-06', taskId: `t${index}`,
    }));

    assert.equal(suggestionsFor(many, { date: '2026-08-06' }).length, 3);
});

test('uses an exclusive following UTC midnight as the day bound', () => {
    assert.deepEqual(utcDayWindow('2026-08-06'), {
        startsAt: '2026-08-06T00:00:00.000Z',
        endsBefore: '2026-08-07T00:00:00.000Z',
    });
});

test('advances UTC day windows across month and year boundaries', () => {
    assert.deepEqual(utcDayWindow('2026-08-31'), {
        startsAt: '2026-08-31T00:00:00.000Z',
        endsBefore: '2026-09-01T00:00:00.000Z',
    });
    assert.deepEqual(utcDayWindow('2026-12-31'), {
        startsAt: '2026-12-31T00:00:00.000Z',
        endsBefore: '2027-01-01T00:00:00.000Z',
    });
});
