import { useCallback, useRef, useState } from 'react';
import {
    applyStageReorder,
    mergeStageTasks,
    restoreStageTasks,
    type StageReorderMove,
} from './stage-reorder';
import type { StageListTask } from './stage-list';

/**
 * Optimistic stage-list edits.
 * The next list is decided here, before React applies state. A setState updater
 * does not run before the following line once a component has updated once, so
 * a save that waits on that updater never leaves the browser. Drag and the
 * move buttons both call `move`. Saves run one at a time so a later click is
 * not dropped while an earlier save is still in flight.
 */
export function useStageListMoves(
    persist: (move: StageReorderMove) => Promise<StageListTask[]>,
    initial: StageListTask[] | null = null,
) {
    const tasksRef = useRef<StageListTask[] | null>(initial);
    const [tasks, setTasks] = useState<StageListTask[] | null>(initial);
    const chain = useRef(Promise.resolve());
    const persistRef = useRef(persist);
    persistRef.current = persist;

    const setList = useCallback((next: StageListTask[] | null) => {
        tasksRef.current = next;
        setTasks(next);
    }, []);

    const updateList = useCallback((update: (current: StageListTask[] | null) => StageListTask[] | null) => {
        const next = update(tasksRef.current);
        tasksRef.current = next;
        setTasks(next);
    }, []);

    const move = useCallback((requested: StageReorderMove) => {
        const current = tasksRef.current;
        if (!current) return Promise.resolve();
        const plan = applyStageReorder(current, requested);
        if (!plan.ok || plan.writes.length === 0) return Promise.resolve();
        const snapshot = current;
        const writeIds = plan.writes.map(write => write.id);
        const optimistic = plan.tasks;
        const save = persistRef.current;
        tasksRef.current = optimistic;
        setTasks(optimistic);

        const run = async () => {
            try {
                const updated = await save(requested);
                if (tasksRef.current !== optimistic || updated.length === 0) return;
                const merged = mergeStageTasks(optimistic, updated);
                tasksRef.current = merged;
                setTasks(merged);
            } catch (caught) {
                if (tasksRef.current === optimistic) {
                    const restored = restoreStageTasks(optimistic, snapshot, writeIds);
                    tasksRef.current = restored;
                    setTasks(restored);
                }
                throw caught instanceof Error ? caught : new Error('move failed');
            }
        };

        const queued = chain.current.then(run, run);
        chain.current = queued.then(() => undefined, () => undefined);
        return queued;
    }, []);

    return { tasks, setList, updateList, move };
}
