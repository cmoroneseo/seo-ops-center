'use client';

import { cn } from '@/lib/utils';

export function ReviewToggle({
    checked,
    disabled = false,
    label,
    hint,
    onChange,
}: {
    checked: boolean;
    disabled?: boolean;
    label: string;
    hint?: string;
    onChange: (next: boolean) => void;
}) {
    return (
        <label className={cn('flex items-start gap-2 select-none text-sm', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
            <input
                type="checkbox"
                role="switch"
                checked={checked}
                disabled={disabled}
                onChange={event => onChange(event.target.checked)}
                className="sr-only peer"
            />
            <span
                aria-hidden="true"
                className={cn(
                    'relative mt-0.5 w-9 h-5 shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50',
                    checked ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
            >
                <span className={cn(
                    'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                    checked ? 'translate-x-4' : 'translate-x-0',
                )} />
            </span>
            <span className="text-muted-foreground">
                {label}
                {hint && <span className="block text-xs text-muted-foreground/60">{hint}</span>}
            </span>
        </label>
    );
}
