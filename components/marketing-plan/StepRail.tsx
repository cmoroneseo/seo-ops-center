'use client';

import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarketingPlanStep, MarketingPlanItem } from '@/lib/types';

interface StepRailProps {
    steps: MarketingPlanStep[];
    items: MarketingPlanItem[];
    activeStepKey: string | null;
    onSelect: (key: string) => void;
}

export function StepRail({ steps, items, activeStepKey, onSelect }: StepRailProps) {
    const sorted = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
    return (
        <nav className="sticky top-4 space-y-1 print:hidden">
            {sorted.map((step, idx) => {
                const stepItems = items.filter(i => i.stepKey === step.key && i.status !== 'ignored');
                const done = stepItems.filter(i => i.status === 'done').length;
                const isActive = activeStepKey === step.key;
                return (
                    <button
                        key={step.key}
                        onClick={() => onSelect(step.key)}
                        className={cn(
                            'w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm text-left transition-colors',
                            isActive
                                ? 'bg-primary text-primary-foreground font-semibold'
                                : 'hover:bg-muted text-foreground',
                        )}
                    >
                        <span className="truncate">Step {idx + 1}: {step.name}</span>
                        <span className={cn(
                            'flex items-center gap-1 shrink-0 text-xs',
                            isActive ? 'text-primary-foreground/80' : 'text-muted-foreground',
                        )}>
                            {done}/{stepItems.length}
                            <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}
