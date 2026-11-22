import React from 'react';
import { cn } from '@/lib/utils';

export function MyTasksBadge({ count, className }: { count: number | null; className?: string }) {
    if (count === null) {
        return <span role="status" aria-busy="true" aria-label="Checking overdue tasks"
            className={cn('ml-auto h-3 w-5 shrink-0 rounded-full bg-muted-foreground/20 motion-safe:animate-pulse', className)} />;
    }
    if (count <= 0) return null;

    return (
        <span
            aria-label={`${count} overdue tasks`}
            className={cn('ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-xs leading-none text-white tabular-nums', className)}
        >
            {count}
        </span>
    );
}
