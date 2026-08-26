'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    TIMESHEET_ACTIVITIES,
    describeActivity,
    type TimesheetActivity,
} from '@/lib/timesheets/activities';

interface ActivityPickerProps {
    /** Every activity this block of time is tagged with. */
    value: string[];
    onChange: (activityKeys: string[]) => void;
    id: string;
    label?: string;
    disabled?: boolean;
    /** Initial disclosure state. The review queue leaves every row closed. */
    defaultOpen?: boolean;
}

const ACTIVITY_GROUPS = (() => {
    const groups = new Map<string, TimesheetActivity[]>();
    for (const activity of TIMESHEET_ACTIVITIES) {
        const group = groups.get(activity.category) ?? [];
        group.push(activity);
        groups.set(activity.category, group);
    }
    return [...groups.entries()];
})();

/**
 * Multi-select activity tagging for one imported entry.
 *
 * A block of time is often several kinds of work at once — reviewed Basecamp
 * data has a 2h block that was GBP Optimization + Keyword Research & Strategy +
 * Content Strategy. The hours are never split; the block carries all its tags.
 *
 * Deliberately NOT a native `<select multiple>`: that control requires
 * shift/ctrl-clicking to select more than one, gives no visible cue that
 * multi-select is even possible, and is close to unusable on touch. This is a
 * hand-rolled disclosure (the same `useState` + outside-click pattern the rest
 * of this codebase uses) over ordinary checkboxes, so keyboard and screen
 * reader support come from the platform rather than from ARIA imitation.
 *
 * The trigger renders the current selection in catalog order, so a manager
 * scanning a queue reads every row's tags without opening anything.
 */
export function ActivityPicker({
    value,
    onChange,
    id,
    label = 'Activity',
    disabled = false,
    defaultOpen = false,
}: ActivityPickerProps) {
    const [open, setOpen] = useState(defaultOpen);
    const containerRef = useRef<HTMLDivElement>(null);
    const panelId = useId();
    const selected = new Set(value);
    const summary = describeActivity(value, '');

    useEffect(() => {
        if (!open) return;
        const onDown = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const toggle = (key: string) => {
        const next = selected.has(key)
            // Catalog order, so the stored set never depends on click order.
            ? value.filter(current => current !== key)
            : TIMESHEET_ACTIVITIES
                .filter(activity => activity.key === key || selected.has(activity.key))
                .map(activity => activity.key);
        onChange(next);
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                id={id}
                type="button"
                disabled={disabled}
                aria-haspopup="true"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                aria-label={`${label}${summary ? `: ${summary}` : ''}`}
                title={summary || undefined}
                onClick={() => setOpen(current => !current)}
                className="flex w-full items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5 text-left text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
                <span
                    className={cn(
                        'flex-1 truncate',
                        summary ? 'text-foreground' : 'text-muted-foreground',
                    )}
                >
                    {summary || 'What was this?'}
                </span>
                {value.length > 1 && (
                    <span className="shrink-0 rounded-full border border-border px-1.5 text-xs text-muted-foreground">
                        {value.length}
                    </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>

            {open && (
                <div
                    id={panelId}
                    role="group"
                    aria-label={`${label} options`}
                    className="absolute z-30 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-lg"
                >
                    {ACTIVITY_GROUPS.map(([category, activities]) => (
                        <div key={category} className="mb-2 last:mb-0">
                            <p className="px-1 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {category}
                            </p>
                            {activities.map(activity => (
                                <label
                                    key={activity.key}
                                    className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-foreground hover:bg-muted"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected.has(activity.key)}
                                        onChange={() => toggle(activity.key)}
                                        className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                    />
                                    <span>{activity.label}</span>
                                </label>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
