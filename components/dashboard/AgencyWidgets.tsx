'use client';

import { Task, Deliverable } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CheckSquare, Clock, AlertCircle, Users, ArrowUpRight, TrendingUp, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

interface AgencyWidgetProps {
    tasks: Task[];
    deliverables?: Deliverable[];
}

export function GlobalDeliverablesStats({ deliverables = [] }: AgencyWidgetProps) {
    const total = deliverables.length;
    const completed = deliverables.filter(d => d.status === 'Approved' || d.status === 'Published').length;
    const inProgress = deliverables.filter(d => d.status === 'In Progress' || d.status === 'Review').length;
    const pending = deliverables.filter(d => d.status === 'Pending').length;

    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
        <div className="rounded-xl border border-border bg-card p-6 h-full flex flex-col">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-6">Deliverables</h3>
            <div className="flex-1 flex flex-col justify-center gap-4">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-3xl font-bold">{completed}/{total}</div>
                        <div className="text-xs text-muted-foreground mt-1">Items Delivered</div>
                    </div>
                    <div className="h-16 w-16 rounded-full border-4 border-muted border-t-green-500 flex items-center justify-center">
                        <span className="text-sm font-bold">{percentage}%</span>
                    </div>
                </div>

                <div className="space-y-2 pt-4 border-t border-border/50">
                    <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                            <div className="h-2 w-2 rounded-full bg-green-500" /> Approved
                        </span>
                        <span className="font-medium">{completed}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                            <div className="h-2 w-2 rounded-full bg-orange-500" /> In Progress
                        </span>
                        <span className="font-medium">{inProgress}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                            <div className="h-2 w-2 rounded-full bg-muted" /> Pending
                        </span>
                        <span className="font-medium">{pending}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function GlobalTaskProgress({ tasks }: AgencyWidgetProps) {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const review = tasks.filter(t => t.status === 'review').length;
    const todo = tasks.filter(t => t.status === 'todo').length;

    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
        <div className="rounded-xl border border-border bg-card p-6 h-full flex flex-col">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-6">Task Progress</h3>
            <div className="flex-1 flex items-center justify-around gap-8">
                <div className="relative h-32 w-32 flex items-center justify-center">
                    <svg className="h-full w-full transform -rotate-90">
                        <circle
                            cx="64"
                            cy="64"
                            r="58"
                            stroke="currentColor"
                            strokeWidth="12"
                            fill="transparent"
                            className="text-muted/30"
                        />
                        <circle
                            cx="64"
                            cy="64"
                            r="58"
                            stroke="currentColor"
                            strokeWidth="12"
                            fill="transparent"
                            strokeDasharray={364}
                            strokeDashoffset={364 - (364 * percentage) / 100}
                            className="text-red-600 transition-all duration-1000 ease-out"
                        />
                    </svg>
                    <div className="absolute flex flex-col items-center">
                        <span className="text-3xl font-bold">{percentage}</span>
                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">% DONE</span>
                    </div>
                </div>

                <div className="space-y-3 flex-1 max-w-[160px]">
                    {[
                        { label: 'To Do', count: todo, color: 'bg-muted' },
                        { label: 'In Review', count: review, color: 'bg-orange-500' },
                        { label: 'Completed', count: completed, color: 'bg-red-600' },
                        { label: 'Overdue', count: 2, color: 'bg-red-500' }, // Hardcoded overdue for demo look
                    ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                                <div className={cn("h-2 w-2 rounded-full", item.color)} />
                                <span className="text-muted-foreground font-medium">{item.label}</span>
                            </div>
                            <span className="font-bold">{item.count}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function GlobalNeedsAttention({ tasks }: AgencyWidgetProps) {
    const unassigned = tasks.filter(t => !t.assignees || t.assignees.length === 0 || t.assignees[0] === 'Unassigned').length;
    const noDueDate = tasks.filter(t => !t.dueDate).length;

    return (
        <div className="rounded-xl border border-border bg-card p-6 h-full flex flex-col">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-6">Needs Attention</h3>
            <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl bg-orange-500/5 border border-orange-500/10 transition-all hover:bg-orange-500/10 cursor-pointer group">
                    <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg bg-orange-500/20 text-orange-500">
                            <Users className="h-5 w-5" />
                        </div>
                        <span className="text-sm font-semibold group-hover:text-orange-500 transition-colors">Unassigned Tasks</span>
                    </div>
                    <span className="text-2xl font-black text-orange-500">{unassigned}</span>
                </div>
                <div className="flex items-center justify-between p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/10 transition-all hover:bg-yellow-500/10 cursor-pointer group">
                    <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg bg-yellow-500/20 text-yellow-500">
                            <Clock className="h-5 w-5" />
                        </div>
                        <span className="text-sm font-semibold group-hover:text-yellow-500 transition-colors">No Due Date</span>
                    </div>
                    <span className="text-2xl font-black text-yellow-500">{noDueDate}</span>
                </div>
            </div>
        </div>
    );
}

export function AgencyQuickStats({ tasks }: AgencyWidgetProps) {
    const overdue = 2; // Demo data
    const dueToday = tasks.filter(t => t.dueDate === new Date().toISOString().split('T')[0]).length;
    const teamMembers = 5;

    return (
        <div className="rounded-xl border border-border bg-card p-6 h-full flex flex-col">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-6">Quick Stats</h3>
            <div className="space-y-1">
                <div className="flex items-center justify-between py-3 border-b border-border/50 group cursor-pointer hover:px-2 transition-all">
                    <div className="flex items-center gap-3">
                        <div className="h-2 w-2 rounded-full bg-red-500" />
                        <span className="text-sm font-medium text-muted-foreground group-hover:text-red-500">Overdue Tasks</span>
                    </div>
                    <span className="text-lg font-bold text-red-500">{overdue}</span>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-border/50 group cursor-pointer hover:px-2 transition-all">
                    <div className="flex items-center gap-3">
                        <div className="h-2 w-2 rounded-full bg-yellow-500" />
                        <span className="text-sm font-medium text-muted-foreground group-hover:text-yellow-500">Due Today</span>
                    </div>
                    <span className="text-lg font-bold text-yellow-500">{dueToday}</span>
                </div>
                <div className="flex items-center justify-between py-3 group cursor-pointer hover:px-2 transition-all">
                    <div className="flex items-center gap-3">
                        <div className="h-2 w-2 rounded-full bg-blue-500" />
                        <span className="text-sm font-medium text-muted-foreground group-hover:text-blue-500">Team Members</span>
                    </div>
                    <span className="text-lg font-bold text-blue-500">{teamMembers}</span>
                </div>
            </div>
        </div>
    );
}

export function GlobalUpcomingTasks({ tasks }: AgencyWidgetProps) {
    // Sort by due date (ignore empty)
    const upcoming = tasks
        .filter(t => t.dueDate && t.status !== 'done')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 8);

    return (
        <div className="rounded-xl border border-border bg-card flex flex-col overflow-hidden shadow-sm">
            <div className="bg-red-950/20 px-6 py-4 flex items-center justify-between border-b border-border">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Upcoming Tasks</h3>
                <Link href="/tasks" className="text-xs font-bold text-muted-foreground hover:text-red-500 flex items-center gap-1 transition-colors">
                    View all <ArrowUpRight className="h-3 w-3" />
                </Link>
            </div>
            <div className="divide-y divide-border/50">
                {upcoming.length > 0 ? (
                    upcoming.map((task) => (
                        <div key={task.id} className="group px-6 py-4 hover:bg-muted/30 transition-all flex items-center justify-between cursor-pointer">
                            <div className="flex items-center gap-4">
                                <div className={cn(
                                    "h-2 w-2 rounded-full",
                                    task.priority === 'high' ? 'bg-red-500' : task.priority === 'medium' ? 'bg-yellow-500' : 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]'
                                )} />
                                <div>
                                    <h4 className="text-sm font-bold text-foreground group-hover:text-red-500 transition-colors">{task.title}</h4>
                                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight">{task.clientName}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-bold text-muted-foreground uppercase tracking-widest border border-border">
                                    {task.tags[0] || 'Task'}
                                </span>
                                <span className={cn(
                                    "text-[10px] font-bold",
                                    new Date(task.dueDate) < new Date() ? "text-red-500" : "text-muted-foreground"
                                )}>
                                    {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-6 py-12 text-center">
                        <CheckSquare className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground font-medium">All caught up! No upcoming tasks.</p>
                        <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mt-1">Check back later or add a new task.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
