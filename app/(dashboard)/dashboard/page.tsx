'use client';

import { useState, useEffect } from 'react';
import { mockTasks } from '@/lib/mock-data/tasks';
import { mockClients } from '@/lib/mock-data/workspace';
import { ClientListPanel } from '@/components/workspace/ClientListPanel';
import { GlobalTaskProgress, GlobalNeedsAttention, AgencyQuickStats, GlobalUpcomingTasks, GlobalDeliverablesStats } from '@/components/dashboard/AgencyWidgets';

export default function DashboardPage() {
    const [tasks] = useState(mockTasks);
    // Aggregate deliverables from all clients
    const deliverables = mockClients.flatMap(c => c.activeDeliverables || []);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;

    return (
        <div className="h-full flex flex-col space-y-8 p-8 overflow-y-auto w-full max-w-7xl mx-auto custom-scrollbar">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h2 className="text-4xl font-black tracking-tight text-foreground underline decoration-red-600 decoration-4 underline-offset-8 mb-2">Dashboard</h2>
                    <p className="text-muted-foreground font-medium italic">Welcome back, Agency Owner.</p>
                </div>
                <div className="bg-orange-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-full flex items-center gap-2 shadow-lg shadow-orange-500/20">
                    <span className="h-2 w-2 bg-white rounded-full animate-pulse" />
                    DEMO MODE ACTIVE (⌘+Shift+D to exit)
                </div>
            </div>

            {/* Top Widgets Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 shrink-0">
                <GlobalTaskProgress tasks={tasks} />
                <GlobalDeliverablesStats deliverables={deliverables} tasks={[]} />
                <GlobalNeedsAttention tasks={tasks} />
                <AgencyQuickStats tasks={tasks} />
            </div>

            {/* Bottom Row: Upcoming Tasks */}
            <div className="flex-1 min-h-[400px]">
                <GlobalUpcomingTasks tasks={tasks} />
            </div>
        </div>
    );
}
