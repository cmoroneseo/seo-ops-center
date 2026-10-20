import test from 'node:test';
import assert from 'node:assert/strict';

import {
    attachSubtaskSnapshots,
    listedSubtaskProgress,
    liveSubtasks,
    progressOf,
    subtaskProgress,
    withSubtaskStatus,
} from './subtask-progress.ts';

/**
 * SEO Setup, as opened from the plan and from the task panel.
 * Four chores, three of them done. A grandchild, a recurring successor with
 * the same title, and an archived row used to make one surface say 5 and
 * the other 4.
 */
const setup = { id: 'setup', title: 'SEO Setup', status: 'todo' };
const chores = [
    { id: 'keywords', title: 'Add keywords', status: 'done', parentTaskId: 'setup' },
    { id: 'robots', title: 'Review robots.txt', status: 'done', parentTaskId: 'setup' },
    { id: 'cookies', title: 'Set cookies', status: 'done', parentTaskId: 'setup' },
    { id: 'sitemap', title: 'Submit sitemap', status: 'todo', parentTaskId: 'setup' },
];
const grandchild = { id: 'grand', title: 'Confirm sitemap index', status: 'todo', parentTaskId: 'sitemap' };
const successor = {
    id: 'successor',
    title: 'SEO Setup',
    status: 'todo',
    parentTaskId: 'setup',
    recurring: true,
};
const archived = {
    id: 'old',
    title: 'Retired checklist row',
    status: 'done',
    parentTaskId: 'setup',
    excluded: true,
};
const tree = [setup, ...chores, grandchild, successor, archived];

test('the panel, the card, and the plan count the same live subtasks', () => {
    const progress = subtaskProgress('setup', tree);
    assert.equal(progress.state, 'ready');
    assert.equal(progress.label, '3/5');
    assert.deepEqual(progress.ids, ['keywords', 'robots', 'cookies', 'sitemap', 'grand']);
    assert.deepEqual(liveSubtasks('setup', tree).map(task => task.id), progress.ids);
    assert.equal(liveSubtasks('setup', tree).some(task => task.id === 'successor' || task.id === 'old'), false);
});

test('a done toggle updates the shared count immediately and reconciles to the saved status', () => {
    const stale = subtaskProgress('setup', tree);
    assert.equal(stale.label, '3/5');
    const optimistic = withSubtaskStatus(tree, 'sitemap', 'done');
    assert.equal(subtaskProgress('setup', optimistic).label, '4/5');
    const reconciled = withSubtaskStatus(optimistic, 'sitemap', 'todo');
    assert.equal(subtaskProgress('setup', reconciled).label, '3/5');
    assert.equal(subtaskProgress('setup', withSubtaskStatus(tree, 'grand', 'done')).label, '4/5');
});

test('an unknown subtask list is loading, not 0/N', () => {
    const loading = subtaskProgress('setup', null);
    assert.equal(loading.state, 'loading');
    assert.equal(loading.label, null);
    assert.equal(loading.total, 0);
    assert.equal(progressOf(null).state, 'loading');
    assert.equal(listedSubtaskProgress({ subtasks: null }).state, 'loading');
    assert.equal(listedSubtaskProgress({ subtasksState: 'loading', subtasks: chores.map(chore => ({
        id: chore.id,
        title: chore.title,
        completed: false,
    })) }).label, null);

    const ready = listedSubtaskProgress({
        subtasksState: 'ready',
        subtasks: [
            { id: 'keywords', title: 'Add keywords', completed: true },
            { id: 'robots', title: 'Review robots.txt', completed: true },
            { id: 'cookies', title: 'Set cookies', completed: true },
            { id: 'sitemap', title: 'Submit sitemap', completed: false },
        ],
    });
    assert.equal(ready.label, '3/4');
    assert.equal(listedSubtaskProgress({ subtasksState: 'unavailable' }).state, 'unavailable');
    assert.equal(listedSubtaskProgress({ subtasks: [] }).state, 'empty');
});

test('hidden, archived, and deleted rows stay out of the count; a folded done row stays in', () => {
    const hidden = { id: 'hidden', title: 'Hidden chore', status: 'done', parentTaskId: 'setup', excluded: true };
    const progress = subtaskProgress('setup', [...tree, hidden]);
    assert.equal(progress.label, '3/5');
    assert.equal(progress.ids.includes('hidden'), false);
    assert.equal(progress.ids.includes('cookies'), true);
});

test('list snapshots use the same live set as the plan counter', () => {
    const parents = [{ ...setup, subtasks: [], recurrence: undefined }];
    const stamped = attachSubtaskSnapshots(parents, tree);
    assert.equal(stamped[0].subtasksState, 'ready');
    assert.deepEqual(stamped[0].subtasks.map(item => item.id), ['keywords', 'robots', 'cookies', 'sitemap', 'grand']);
    assert.equal(listedSubtaskProgress(stamped[0]).label, '3/5');

    const unavailable = attachSubtaskSnapshots(parents, null);
    assert.equal(unavailable[0].subtasksState, 'unavailable');
    assert.equal(listedSubtaskProgress(unavailable[0]).label, null);
});
