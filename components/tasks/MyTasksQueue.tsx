import type { Task } from '@/lib/types';
import { groupMyTasks, taskFilterLabels } from '@/lib/tasks/my-tasks';

const sections = [
    ['overdue', 'Overdue'],
    ['today', 'Today'],
    ['upcoming', 'Upcoming'],
    ['completed', 'Completed'],
] as const;

export function MyTasksQueue({ groups, onTaskClick }: {
    groups: ReturnType<typeof groupMyTasks>;
    onTaskClick: (task: Task) => void;
}) {
    const visibleSections = sections.filter(([key]) => groups[key].length > 0);
    if (!visibleSections.length) {
        return <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">No tasks are assigned to you in this view.</p>;
    }
    return (
        <div className="space-y-6 pb-6">
            {visibleSections.map(([key, label]) => (
                <section key={key} aria-labelledby={`my-tasks-${key}`}>
                    <h3 id={`my-tasks-${key}`} className="mb-2 text-sm font-semibold">
                        {label} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{groups[key].length}</span>
                    </h3>
                    <div className="overflow-x-auto rounded-xl border border-border/50 bg-card">
                        <table className="w-full min-w-[560px] text-left text-sm">
                            <thead className="bg-muted/50 text-xs text-muted-foreground">
                                <tr>
                                    {['Task', 'Client', 'Status', 'Priority', 'Due date'].map(label => (
                                        <th key={label} scope="col" className="px-4 py-3">{label}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {groups[key].map(task => (
                                    <tr key={task.id} onClick={() => onTaskClick(task)} className="cursor-pointer hover:bg-muted/30">
                                        <td className="w-2/5 px-4 py-3 font-medium">
                                            <button type="button" onClick={event => { event.stopPropagation(); onTaskClick(task); }} className="text-left hover:underline">
                                                {task.title}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3">{task.clientName || '—'}</td>
                                        <td className="whitespace-nowrap px-4 py-3">{taskFilterLabels[task.status]}</td>
                                        <td className="px-4 py-3 capitalize">{task.priority}</td>
                                        <td className="whitespace-nowrap px-4 py-3">{task.dueDate ? new Date(`${task.dueDate}T00:00:00`).toLocaleDateString() : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ))}
        </div>
    );
}
