'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useOrganization } from '@/components/providers/organization-provider';

interface ChecklistItem {
    id: string;
    title: string;
    description: string;
    isCompleted: boolean;
    actionLabel: string;
    actionHref: string;
}

export function OnboardingChecklist() {
    const { organization } = useOrganization();
    const [isExpanded, setIsExpanded] = useState(true);
    const [items, setItems] = useState<ChecklistItem[]>([
        {
            id: 'org',
            title: 'Create Organization',
            description: 'Set up your agency profile.',
            isCompleted: true,
            actionLabel: 'Settings',
            actionHref: '/settings'
        },
        {
            id: 'client',
            title: 'Add Your First Client',
            description: 'Import or create a client to start tracking.',
            isCompleted: false,
            actionLabel: 'Add Client',
            actionHref: '/workspace'
        },
        {
            id: 'task',
            title: 'Create an SEO Task',
            description: 'Assign work to your team.',
            isCompleted: false,
            actionLabel: 'Workspace',
            actionHref: '/workspace'
        },
        {
            id: 'team',
            title: 'Invite Team Members',
            description: 'Collaborate with your SEO specialists.',
            isCompleted: false,
            actionLabel: 'Invite',
            actionHref: '/settings'
        },
        {
            id: 'report',
            title: 'View Monthly Report',
            description: 'See the AI-driven performance insights.',
            isCompleted: false,
            actionLabel: 'Reports',
            actionHref: '/dashboard'
        }
    ]);

    useEffect(() => {
        if (!organization) return;

        const checkProgress = async () => {
            const supabase = createClient();
            if (!supabase) return;

            // 1. Check Clients
            const { count: clientCount } = await supabase
                .from('clients')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organization.id);

            // 2. Check Tasks
            const { count: taskCount } = await supabase
                .from('tasks')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organization.id);

            // 3. Check Members
            const { count: memberCount } = await supabase
                .from('organization_members')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organization.id);

            // 4. Check Reports
            const { count: reportCount } = await supabase
                .from('reports')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organization.id);

            setItems(prev => prev.map(item => {
                if (item.id === 'client') return { ...item, isCompleted: (clientCount || 0) > 0 };
                if (item.id === 'task') return { ...item, isCompleted: (taskCount || 0) > 0 };
                if (item.id === 'team') return { ...item, isCompleted: (memberCount || 0) > 1 }; // > 1 because owner is already there
                if (item.id === 'report') return { ...item, isCompleted: (reportCount || 0) > 0 };
                return item;
            }));
        };

        checkProgress();
    }, [organization]);

    const completedCount = items.filter(i => i.isCompleted).length;
    const progress = Math.round((completedCount / items.length) * 100);

    if (progress === 100 && !isExpanded) return null;

    return (
        <div className={cn(
            "fixed bottom-6 right-6 w-80 bg-card border border-border rounded-xl shadow-2xl transition-all duration-300 z-50",
            !isExpanded && "w-64"
        )}>
            <div
                className="p-4 flex items-center justify-between cursor-pointer border-b border-border/50"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/10">
                        <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold">Getting Started</h3>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{completedCount}/{items.length} Completed</p>
                    </div>
                </div>
                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
            </div>

            {isExpanded && (
                <div className="p-4 space-y-4">
                    <div className="space-y-1.5">
                        <div className="flex justify-between text-[11px] font-bold">
                            <span>Setup Progress</span>
                            <span>{progress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-500 ease-out"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>

                    <div className="space-y-3">
                        {items.map((item) => (
                            <div key={item.id} className="group flex gap-3">
                                <div className="mt-0.5">
                                    {item.isCompleted ? (
                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                    ) : (
                                        <Circle className="h-4 w-4 text-muted-foreground/50" />
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <h4 className={cn("text-xs font-semibold leading-none", item.isCompleted && "text-muted-foreground line-through")}>
                                        {item.title}
                                    </h4>
                                    {!item.isCompleted && (
                                        <>
                                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                                {item.description}
                                            </p>
                                            <a
                                                href={item.actionHref}
                                                className="inline-block text-[11px] font-bold text-primary hover:underline"
                                            >
                                                {item.actionLabel} →
                                            </a>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!isExpanded && (
                <div className="px-4 py-2 pb-3">
                    <div className="h-1 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-500 ease-out"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
