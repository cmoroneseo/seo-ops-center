'use client';

import { Calendar, User, Play, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task } from '@/lib/types';
import { taskDescriptionText } from '@/lib/tasks/description';
import { listedSubtaskProgress } from '@/lib/tasks/subtask-progress';
import { useTimer } from '@/components/providers/timer-provider';
import { SubtaskProgressText } from './SubtaskProgressText';

interface TaskCardProps {
    task: Task;
    clientId?: string;
    clientName?: string;
    memberMap?: Record<string, string>;
}

export function TaskCard({ task, clientId, clientName, memberMap = {} }: TaskCardProps) {
    const { runningTimer, startTask, pause } = useTimer();

    const isThisTaskRunning =
        runningTimer?.taskId === task.id;

    const handleTimerClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isThisTaskRunning && runningTimer) {
            await pause(runningTimer);
        } else {
            await startTask({
                clientId: clientId ?? task.clientId ?? task.projectId ?? '',
                clientName: clientName ?? task.clientName ?? 'Unknown',
                taskId: task.id,
                taskTitle: task.title,
            });
        }
    };

    const canStartTimer = !!(clientId || task.clientId || task.projectId);

    return (
        <div className="group relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:border-primary/50">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                <h4 className="font-medium text-foreground text-sm leading-snug">{task.title}</h4>
                {taskDescriptionText(task.description) && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{taskDescriptionText(task.description)}</p>
                )}
            </div>
                <span className={cn(
                    "h-2 w-2 shrink-0 rounded-full mt-1",
                    task.priority === 'urgent' ? "bg-red-600 ring-1 ring-red-600/40" :
                    task.priority === 'high' ? "bg-red-500" :
                    task.priority === 'medium' ? "bg-yellow-500" :
                    "bg-blue-500"
                )} />
            </div>

            <SubtaskProgressText progress={listedSubtaskProgress(task)} className="text-xs text-muted-foreground" />

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    <span>{(() => {
                        const id = task.assigneeIds?.[0] || task.assignees?.[0];
                        if (!id) return 'Unassigned';
                        return memberMap[id] ?? 'Unassigned';
                    })()}</span>
                </div>
                {task.dueDate && (
                    <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <span>{new Date(task.dueDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                )}
            </div>

            {canStartTimer && (
                <button
                    onClick={handleTimerClick}
                    className={cn(
                        'flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1 transition-all duration-150 w-fit',
                        isThisTaskRunning
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25'
                            : 'bg-muted text-muted-foreground hover:bg-green-500/15 hover:text-green-600 dark:hover:text-green-400 opacity-0 group-hover:opacity-100'
                    )}
                >
                    {isThisTaskRunning
                        ? <><Pause className="h-3 w-3 fill-current" /> Pause</>
                        : <><Play className="h-3 w-3 fill-current" /> Start Timer</>
                    }
                </button>
            )}
        </div>
    );
}
