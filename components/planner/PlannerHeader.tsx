'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export type PlannerView = 'day' | 'week' | 'month';

const VIEWS: PlannerView[] = ['day', 'week', 'month'];

/** Short zone label for the header, e.g. "PDT". */
export function localTimezoneLabel(): string {
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
        .formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
}

interface PlannerHeaderProps {
    anchorDate: Date;
    view: PlannerView;
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
    onViewChange: (view: PlannerView) => void;
}

export function PlannerHeader({
    anchorDate, view, onPrev, onNext, onToday, onViewChange,
}: PlannerHeaderProps) {
    return (
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <button
                onClick={onPrev}
                aria-label="Previous"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
                <ChevronLeft className="h-4 w-4" />
            </button>
            <button
                onClick={onNext}
                aria-label="Next"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
                <ChevronRight className="h-4 w-4" />
            </button>

            <h1 className="text-lg font-semibold">{format(anchorDate, 'MMMM yyyy')}</h1>

            <button
                onClick={onToday}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
                Today
            </button>

            <div className="ml-auto flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{localTimezoneLabel()}</span>
                <div className="flex rounded-md border border-border p-0.5">
                    {VIEWS.map(v => (
                        <button
                            key={v}
                            onClick={() => onViewChange(v)}
                            className={cn(
                                'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                                view === v
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
