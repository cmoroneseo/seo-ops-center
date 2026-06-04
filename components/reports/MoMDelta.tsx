'use client';

import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { computeDelta } from '@/lib/reports/sections';
import { cn } from '@/lib/utils';

export function MoMDelta({ current, previous, lowerIsBetter }: { current: unknown; previous: unknown; lowerIsBetter?: boolean }) {
    const d = computeDelta(current, previous, lowerIsBetter);
    if (!d) return null;

    const Icon = d.direction === 'up' ? ArrowUp : d.direction === 'down' ? ArrowDown : Minus;
    return (
        <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium', d.isGood ? 'text-green-500' : 'text-red-500')}>
            <Icon className="h-3 w-3" />
            {Math.abs(d.pct).toFixed(1)}%
        </span>
    );
}
