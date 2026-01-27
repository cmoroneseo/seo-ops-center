import { Calendar, User } from 'lucide-react';
import { cn } from '@/lib/utils';

import { Task } from '@/lib/types';

interface TaskCardProps {
    task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
    return (
        <div className="group relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:border-primary/50">
            <div className="flex items-start justify-between">
                <h4 className="font-medium text-foreground">{task.title}</h4>
                <span className={cn(
                    "h-2 w-2 rounded-full",
                    task.priority === 'high' ? "bg-red-500" :
                        task.priority === 'medium' ? "bg-yellow-500" :
                            "bg-blue-500"
                )} />
            </div>

            <div className="flex items-center gap-1">
                <User className="h-3 w-3" />
                <span>{task.assignees[0] || 'Unassigned'}</span>
            </div>
            <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                <span>{task.dueDate}</span>
            </div>
        </div>
    );
}
