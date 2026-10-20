import type { SubtaskProgress } from '@/lib/tasks/subtask-progress';

/** The same progress text everywhere. Loading never falls through to 0/N. */
export function SubtaskProgressText({
    progress,
    className,
}: {
    progress: SubtaskProgress;
    className?: string;
}) {
    if (progress.state === 'loading') {
        return (
            <span role="status" aria-label="Loading subtasks" className={className} data-subtask-progress="loading">
                Loading subtasks
            </span>
        );
    }
    if (progress.state === 'unavailable') {
        return (
            <span className={className} data-subtask-progress="unavailable">
                Subtasks unavailable
            </span>
        );
    }
    if (progress.state !== 'ready' || !progress.label) return null;
    return (
        <span className={className} data-subtask-progress={progress.label}>
            {progress.label}
        </span>
    );
}
