import type { Task } from '../types';

/**
 * Fold a saved task row onto the one the list already shows.
 * `updateTask` returns a row whose subtask list is empty, and a null description
 * comes back as undefined. Neither one should wipe the card.
 */
export function mergeSavedTask(previous: Task, saved: Task): Task {
    const knowsSubtasks = saved.subtasksState === 'ready'
        || saved.subtasksState === 'unavailable'
        || saved.subtasksState === 'loading';
    return {
        ...previous,
        ...saved,
        description: saved.description !== undefined ? saved.description : previous.description,
        clientName: saved.clientName ?? previous.clientName,
        subtasks: knowsSubtasks ? saved.subtasks : previous.subtasks,
        subtasksState: knowsSubtasks ? saved.subtasksState : previous.subtasksState,
    };
}
