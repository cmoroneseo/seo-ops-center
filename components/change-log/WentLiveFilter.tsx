'use client';

import { useRef, useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    LIVE_RANGE_PRESETS,
    clearLiveRange,
    customLiveRange,
    liveRangeForPreset,
    liveRangeLabel,
    matchLiveRange,
    type LiveRange,
    type LiveRangePreset,
} from '@/lib/change-log/list';
import { cn } from '@/lib/utils';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

const QUICK_PRESETS = LIVE_RANGE_PRESETS.filter(
    (item): item is { id: '30' | '90' | 'all'; label: string } => item.id !== 'custom',
);

export function WentLiveFilter({
    from,
    to,
    today,
    onChange,
}: {
    from: string;
    to: string;
    today: string;
    onChange: (range: LiveRange) => void;
}) {
    const [open, setOpen] = useState(false);
    const [customOpen, setCustomOpen] = useState(false);
    const anchorRef = useRef<HTMLDivElement>(null);
    const range = { from, to };
    const preset = matchLiveRange(range, today);
    const label = liveRangeLabel(range, today);
    const showCustom = customOpen || preset === 'custom';

    function applyPreset(next: Exclude<LiveRangePreset, 'custom'>) {
        onChange(next === 'all' ? clearLiveRange() : liveRangeForPreset(next, today));
        setCustomOpen(false);
        setOpen(false);
    }

    return (
        <Popover
            modal={false}
            open={open}
            onOpenChange={next => {
                setOpen(next);
                if (next) setCustomOpen(preset === 'custom');
            }}
        >
            <div ref={anchorRef} className="relative">
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-went-live={preset}
                    aria-label={`Went live: ${label}`}
                    className={cn(
                        'inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm whitespace-nowrap shadow-xs',
                        FOCUS,
                    )}
                >
                    <Calendar aria-hidden="true" className="size-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Went live:</span>
                    <span className="font-medium">{label}</span>
                    <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
                </button>
            </PopoverTrigger>
            <PopoverContent container={anchorRef.current} align="start" side="bottom" className="w-72 p-2">
                <div role="group" aria-label="Went live" className="flex flex-col">
                    {QUICK_PRESETS.map(item => {
                        const selected = preset === item.id && !showCustom;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                data-preset={item.id}
                                aria-pressed={selected}
                                className={cn(
                                    'rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                                    selected && 'bg-muted font-medium',
                                    FOCUS,
                                )}
                                onClick={() => applyPreset(item.id)}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                    <button
                        type="button"
                        data-preset="custom"
                        aria-pressed={showCustom}
                        className={cn(
                            'rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                            showCustom && 'bg-muted font-medium',
                            FOCUS,
                        )}
                        onClick={() => setCustomOpen(true)}
                    >
                        Custom
                    </button>
                </div>
                {showCustom ? (
                    <div className="mt-2 space-y-2 border-t border-border pt-2">
                        <label className="block text-xs font-medium text-muted-foreground" htmlFor="went-live-from">
                            From
                        </label>
                        <Input
                            id="went-live-from"
                            type="date"
                            value={from}
                            onChange={event => onChange(customLiveRange(event.target.value, to))}
                        />
                        <label className="block text-xs font-medium text-muted-foreground" htmlFor="went-live-to">
                            To
                        </label>
                        <Input
                            id="went-live-to"
                            type="date"
                            value={to}
                            onChange={event => onChange(customLiveRange(from, event.target.value))}
                        />
                    </div>
                ) : null}
                {preset !== 'all' ? (
                    <button
                        type="button"
                        data-preset="clear"
                        className={cn(
                            'mt-2 w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                            FOCUS,
                        )}
                        onClick={() => applyPreset('all')}
                    >
                        Clear
                    </button>
                ) : null}
            </PopoverContent>
            </div>
        </Popover>
    );
}
