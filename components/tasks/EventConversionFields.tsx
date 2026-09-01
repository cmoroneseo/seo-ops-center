'use client';

import React from 'react';
import { Clock, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ClientOption {
    id: string;
    clientName: string;
}

interface EventConversionFieldsProps {
    clients: ClientOption[];
    clientSearch: string;
    selectedClientId: string;
    durationMinutes: number;
    logEventTime: boolean;
    countsTowardBudget: boolean;
    syncTimeToBasecamp: boolean;
    onClientSearchChange: (value: string) => void;
    onLogEventTimeChange: (value: boolean) => void;
    onCountsTowardBudgetChange: (value: boolean) => void;
    onSyncTimeToBasecampChange: (value: boolean) => void;
}

function Toggle({
    checked,
    onChange,
    label,
    disabled = false,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className="flex min-h-9 w-full items-center gap-2 text-left text-xs disabled:opacity-50"
        >
            <span className={cn(
                'relative h-4 w-7 shrink-0 rounded-full transition-colors',
                checked ? 'bg-primary' : 'bg-border',
            )}>
                <span className={cn(
                    'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
                    checked ? 'translate-x-3.5' : 'translate-x-0.5',
                )} />
            </span>
            <span>{label}</span>
        </button>
    );
}

export function EventConversionFields({
    clients,
    clientSearch,
    selectedClientId,
    durationMinutes,
    logEventTime,
    countsTowardBudget,
    syncTimeToBasecamp,
    onClientSearchChange,
    onLogEventTimeChange,
    onCountsTowardBudgetChange,
    onSyncTimeToBasecampChange,
}: EventConversionFieldsProps) {
    return (
        <div className="space-y-3 rounded-xl border border-border bg-muted/10 p-3">
            <div>
                <label
                    htmlFor="event-conversion-client"
                    className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                    Client
                </label>
                <div className="relative mt-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                        id="event-conversion-client"
                        list="event-conversion-client-options"
                        value={clientSearch}
                        onChange={event => onClientSearchChange(event.target.value)}
                        placeholder="Search or select a client…"
                        aria-invalid={Boolean(clientSearch && !selectedClientId)}
                        className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
                    />
                    <datalist id="event-conversion-client-options">
                        {clients.map(client => (
                            <option key={client.id} value={client.clientName} />
                        ))}
                    </datalist>
                </div>
                {clientSearch && !selectedClientId && (
                    <p className="mt-1 text-[10px] text-destructive">Select a client from the list.</p>
                )}
            </div>

            <div className="border-t border-border/60 pt-2">
                <Toggle
                    checked={logEventTime}
                    onChange={onLogEventTimeChange}
                    label={`Log original event time — ${durationMinutes} min`}
                />
                <div className="ml-7 border-l border-border pl-3">
                    <Toggle
                        checked={countsTowardBudget}
                        onChange={onCountsTowardBudgetChange}
                        disabled={!logEventTime}
                        label="Count toward client SEO budget"
                    />
                    <Toggle
                        checked={syncTimeToBasecamp}
                        onChange={onSyncTimeToBasecampChange}
                        disabled={!logEventTime}
                        label="Send time to Basecamp timesheet"
                    />
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    The entry stays linked to this calendar event and its new task.
                </p>
            </div>
        </div>
    );
}
