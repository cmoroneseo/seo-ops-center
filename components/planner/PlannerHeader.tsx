'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { PlannerPreferences } from '@/lib/planner/preferences';
import { PlannerSettings } from './PlannerSettings';

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
    prefs: PlannerPreferences;
    onPrefsChange: (next: PlannerPreferences) => void;
}

export function PlannerHeader({
    anchorDate, view, onPrev, onNext, onToday, onViewChange, prefs, onPrefsChange,
}: PlannerHeaderProps) {
    return (
        <header className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:gap-3 sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-center gap-1 sm:contents">
                <button
                    type="button"
                    onClick={onPrev}
                    aria-label="Previous period"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={onNext}
                    aria-label="Next period"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>

                <h1 className="min-w-0 flex-1 truncate px-1 text-base font-semibold sm:flex-none sm:px-0 sm:text-lg" aria-live="polite">
                    {format(anchorDate, 'MMMM yyyy')}
                </h1>

                <button
                    type="button"
                    onClick={onToday}
                    className="h-11 shrink-0 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    Today
                </button>
            </div>

            <div className="flex min-w-0 items-center gap-2 sm:ml-auto sm:gap-3">
                <span className="text-xs text-muted-foreground">{localTimezoneLabel()}</span>
                <div className="ml-auto flex min-w-0 rounded-md border border-border p-0.5 sm:ml-0" role="group" aria-label="Planner view">
                    {VIEWS.map(v => (
                        <button
                            type="button"
                            key={v}
                            onClick={() => onViewChange(v)}
                            aria-pressed={view === v}
                            className={cn(
                                'min-h-10 min-w-0 flex-1 rounded px-2 text-xs font-medium capitalize transition-colors sm:min-h-0 sm:flex-none sm:px-2.5 sm:py-1',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                view === v
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {v}
                        </button>
                    ))}
                </div>

                <PlannerSettings prefs={prefs} onChange={onPrefsChange} />
            </div>
        </header>
    );
}
