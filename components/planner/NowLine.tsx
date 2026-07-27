'use client';

import { useEffect, useState } from 'react';
import { minutesToY } from '@/lib/planner/layout';

interface NowLineProps {
    startHour: number;
}

/**
 * Red current-time rule. Rendered inside today's column only, and only when
 * today is in the visible range — the caller decides that.
 */
export function NowLine({ startHour }: NowLineProps) {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(id);
    }, []);

    const minutes = now.getHours() * 60 + now.getMinutes();
    const top = minutesToY(minutes, startHour);

    return (
        <div
            className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
            style={{ top }}
        >
            <span className="-ml-9 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
                {now.getHours() % 12 || 12}:{String(now.getMinutes()).padStart(2, '0')}
            </span>
            <div className="h-px flex-1 bg-red-500" />
        </div>
    );
}
