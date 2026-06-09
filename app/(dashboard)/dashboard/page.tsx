'use client';

import { useState, useEffect } from 'react';
import { GlobalTaskProgress, GlobalNeedsAttention, AgencyQuickStats, GlobalUpcomingTasks, GlobalDeliverablesStats, MyTimeWidget } from '@/components/dashboard/AgencyWidgets';
import { useOrganization } from '@/components/providers/organization-provider';
import { getDeliverables } from '@/lib/supabase/deliverables';
import { getTasks } from '@/lib/supabase/tasks';
import { Deliverable, Task } from '@/lib/types';

export default function DashboardPage() {
    const { organization } = useOrganization();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!organization) return;
        getDeliverables(organization.id).then(setDeliverables);
        getTasks(organization.id).then(setTasks);
    }, [organization?.id]);

    if (!mounted) return null;

    return (
        <div className="h-full flex flex-col space-y-8 p-8 overflow-y-auto w-full max-w-7xl mx-auto custom-scrollbar">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h2 className="text-4xl font-black tracking-tight text-foreground underline decoration-red-600 decoration-4 underline-offset-8 mb-2">Dashboard</h2>
                    <p className="text-muted-foreground font-medium italic">
                        Welcome back, {organization?.name ?? 'Agency'}.
                    </p>
                </div>
            </div>

            {/* Top Widgets Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 shrink-0">
                <GlobalTaskProgress tasks={tasks} />
                <GlobalDeliverablesStats deliverables={deliverables} tasks={[]} />
                <GlobalNeedsAttention tasks={tasks} />
                <AgencyQuickStats tasks={tasks} />
            </div>

            {/* Bottom Row: Upcoming Tasks + My Time */}
            <div className="flex-1 min-h-[400px] grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <GlobalUpcomingTasks tasks={tasks} />
                </div>
                <div>
                    <MyTimeWidget />
                </div>
            </div>
        </div>
    );
}
