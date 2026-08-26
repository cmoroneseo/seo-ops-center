'use client';

import React from 'react';
import { TIMESHEET_ACTIVITIES, type TimesheetActivity } from '@/lib/timesheets/activities';

interface ActivityPickerProps {
    value: string | null;
    onChange: (activityKey: string) => void;
    id: string;
    disabled?: boolean;
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
 * A grouped activity choice replaces repetitive descriptions and determines
 * the entry's budget default in the row editor.
 */
export function ActivityPicker({ value, onChange, id, disabled = false }: ActivityPickerProps) {
    return (
        <select
            id={id}
            aria-label="Activity"
            value={value ?? ''}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
            <option value="" disabled>What was this?</option>
            {ACTIVITY_GROUPS.map(([category, activities]) => (
                <optgroup key={category} label={category}>
                    {activities.map(activity => (
                        <option key={activity.key} value={activity.key}>
                            {activity.label}
                        </option>
                    ))}
                </optgroup>
            ))}
        </select>
    );
}
