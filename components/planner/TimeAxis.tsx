'use client';

import { PX_PER_HOUR } from '@/lib/planner/layout';

interface TimeAxisProps {
    startHour: number;
    endHour: number;
}

function hourLabel(hour: number): string {
    const h = hour % 24;
    if (h === 0) return '12 am';
    if (h === 12) return '12 pm';
    return h < 12 ? `${h} am` : `${h - 12} pm`;
}

export function TimeAxis({ startHour, endHour }: TimeAxisProps) {
    const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
    return (
        <div className="w-16 shrink-0 select-none border-r border-border">
            {hours.map(hour => (
                <div
                    key={hour}
                    style={{ height: PX_PER_HOUR }}
                    className="relative"
                >
                    <span className="absolute -top-2 right-2 text-[11px] text-muted-foreground">
                        {hourLabel(hour)}
                    </span>
                </div>
            ))}
        </div>
    );
}
