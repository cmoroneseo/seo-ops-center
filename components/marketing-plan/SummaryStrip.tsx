'use client';

import { ChevronsUp, Equal, ChevronsDown } from 'lucide-react';
import { PlanSummary } from '@/lib/marketing-plan-logic';

export function SummaryStrip({ summary }: { summary: PlanSummary }) {
    const s = summary;
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 rounded-xl border border-border/50 bg-card divide-y md:divide-y-0 md:divide-x divide-border/50 print:hidden">
            {/* Plan progress */}
            <div className="p-4 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Plan Progress</div>
                <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-primary">{s.done}</span>
                    <span className="text-lg text-muted-foreground">/{s.total}</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${s.progressPercent}%` }}
                        />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{s.progressPercent}%</span>
                </div>
            </div>
            {/* Status counts */}
            <div className="p-4 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</div>
                <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-500" /> To Do</span>
                        <span className="font-semibold">{s.todo}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500" /> Done</span>
                        <span className="font-semibold">{s.done}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gray-400" /> Ignored</span>
                        <span className="font-semibold">{s.ignored}</span>
                    </div>
                </div>
            </div>
            {/* Priority counts */}
            <div className="p-4 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Priority</div>
                <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><ChevronsUp className="h-3.5 w-3.5 text-red-500" /> High</span>
                        <span className="font-semibold">{s.priorityCounts.high}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><Equal className="h-3.5 w-3.5 text-yellow-500" /> Medium</span>
                        <span className="font-semibold">{s.priorityCounts.medium}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><ChevronsDown className="h-3.5 w-3.5 text-blue-500" /> Low</span>
                        <span className="font-semibold">{s.priorityCounts.low}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
