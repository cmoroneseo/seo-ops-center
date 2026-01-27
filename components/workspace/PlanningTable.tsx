'use client';

import { ClientProject, MonthlyPlan, WeeklyPlan } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Calendar, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

interface PlanningTableProps {
    clients: ClientProject[];
    plans: MonthlyPlan[];
}

export function PlanningTable({ clients, plans }: PlanningTableProps) {
    const [currentMonth, setCurrentMonth] = useState('2025-11'); // Default to Nov 2025 for demo

    // Filter plans for the current month
    const currentPlans = plans.filter(p => p.month === currentMonth);

    // Helper to get plan for a client
    const getPlan = (clientId: string) => currentPlans.find(p => p.clientId === clientId);

    // Helper to get week data
    const getWeekData = (plan: MonthlyPlan | undefined, weekNum: number) => {
        return plan?.weeks.find(w => w.weekNumber === weekNum);
    };

    const weeks = [1, 2, 3, 4, 5]; // Assuming 5 weeks for now
    const weekLabels = ['Nov 3-7', 'Nov 10-14', 'Nov 17-21', 'Nov 24-28', 'Dec 1-5'];

    return (
        <div className="space-y-4">
            {/* Month Selector */}
            <div className="flex items-center justify-between bg-card p-3 rounded-lg border border-border/50">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <button className="p-1 hover:bg-muted rounded-full transition-colors">
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="font-semibold min-w-[120px] text-center flex items-center justify-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            November 2025
                        </span>
                        <button className="p-1 hover:bg-muted rounded-full transition-colors">
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="h-4 w-px bg-border" />
                    <div className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{currentPlans.length}</span> Clients Planned
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 text-xs">
                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /> On Track</span>
                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500" /> Over Budget</span>
                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500" /> Under Budget</span>
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-muted/50 text-muted-foreground font-medium">
                            <tr>
                                <th className="px-4 py-3 sticky left-0 bg-muted/50 z-10 w-[200px] border-r border-border/50">Client</th>
                                <th className="px-2 py-3 text-center w-[60px]">Tier</th>
                                <th className="px-2 py-3 text-center w-[80px]">Budget</th>
                                <th className="px-2 py-3 text-center w-[80px] border-r border-border/50">Total</th>

                                {weeks.map((week, i) => (
                                    <th key={week} colSpan={3} className="px-2 py-3 text-center border-r border-border/50 min-w-[180px]">
                                        {weekLabels[i]}
                                    </th>
                                ))}
                            </tr>
                            <tr className="text-xs border-b border-border/50 bg-muted/30">
                                <th className="sticky left-0 bg-muted/30 z-10 border-r border-border/50"></th>
                                <th colSpan={2}></th>
                                <th className="text-center py-1 border-r border-border/50">Var</th>
                                {weeks.map(week => (
                                    <>
                                        <th key={`p-${week}`} className="text-center py-1 text-muted-foreground/70 font-normal">Plan</th>
                                        <th key={`l-${week}`} className="text-center py-1 text-muted-foreground/70 font-normal">Log</th>
                                        <th key={`v-${week}`} className="text-center py-1 border-r border-border/50 font-normal">Var</th>
                                    </>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {clients.map((client) => {
                                const plan = getPlan(client.id);
                                if (!plan) return null; // Only show clients with plans for now

                                return (
                                    <tr key={client.id} className="hover:bg-muted/20 transition-colors group">
                                        <td className="px-4 py-2 sticky left-0 bg-card group-hover:bg-muted/20 z-10 border-r border-border/50 font-medium">
                                            {client.clientName}
                                        </td>
                                        <td className="px-2 py-2 text-center text-xs text-muted-foreground">T{client.tier}</td>
                                        <td className="px-2 py-2 text-center font-medium">{client.seoHours}</td>
                                        <td className={cn(
                                            "px-2 py-2 text-center font-bold border-r border-border/50",
                                            plan.totalVariance < 0 ? "text-red-500" : "text-green-500"
                                        )}>
                                            {plan.totalVariance.toFixed(2)}
                                        </td>

                                        {weeks.map(week => {
                                            const weekData = getWeekData(plan, week);
                                            const variance = weekData?.variance || 0;
                                            const isNegative = variance < 0;
                                            const isPositive = variance > 0;

                                            return (
                                                <>
                                                    <td className="px-2 py-2 text-center bg-muted/5">
                                                        {weekData?.planned || '-'}
                                                    </td>
                                                    <td className="px-2 py-2 text-center">
                                                        {weekData?.logged || '-'}
                                                    </td>
                                                    <td className={cn(
                                                        "px-2 py-2 text-center border-r border-border/50 font-medium",
                                                        isNegative && "bg-red-500/10 text-red-600",
                                                        isPositive && "bg-green-500/10 text-green-600"
                                                    )}>
                                                        {variance !== 0 ? variance.toFixed(2) : '-'}
                                                    </td>
                                                </>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
