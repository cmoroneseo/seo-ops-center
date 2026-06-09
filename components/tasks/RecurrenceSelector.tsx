'use client';

import { Task } from '@/lib/types';
import { describeRecurrence } from '@/lib/utils/recurrence';
import { cn } from '@/lib/utils';

type Recurrence = NonNullable<Task['recurrence']>;

interface RecurrenceSelectorProps {
    value?: Recurrence;
    onChange: (value: Recurrence | undefined) => void;
    className?: string;
}

const FREQ_OPTIONS = [
    { value: 'none', label: 'None' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
] as const;

const DOW_OPTIONS = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
];

export function RecurrenceSelector({ value, onChange, className }: RecurrenceSelectorProps) {
    const freq = value?.freq ?? 'none';

    const handleFreqChange = (newFreq: string) => {
        if (newFreq === 'none') {
            onChange(undefined);
            return;
        }
        const base: Recurrence = { freq: newFreq as Recurrence['freq'] };
        if (newFreq === 'weekly') base.dayOfWeek = 1; // default Monday
        if (newFreq === 'monthly') base.dayOfMonth = 1; // default 1st
        onChange(base);
    };

    const handleDayOfWeek = (dow: number) => {
        if (!value) return;
        onChange({ ...value, dayOfWeek: dow });
    };

    const handleDayOfMonth = (dom: number) => {
        if (!value) return;
        const clamped = Math.min(Math.max(1, dom), 28);
        onChange({ ...value, dayOfMonth: clamped });
    };

    const handleEndDate = (date: string) => {
        if (!value) return;
        onChange({ ...value, endDate: date || undefined });
    };

    return (
        <div className={cn('space-y-2', className)}>
            {/* Frequency selector */}
            <div className="flex gap-2 flex-wrap">
                {FREQ_OPTIONS.map(opt => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleFreqChange(opt.value)}
                        className={cn(
                            'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                            (opt.value === 'none' ? !value : value?.freq === opt.value)
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/50',
                        )}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {/* Weekly: day-of-week picker */}
            {value?.freq === 'weekly' && (
                <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Day of week</label>
                    <select
                        value={value.dayOfWeek ?? 1}
                        onChange={e => handleDayOfWeek(Number(e.target.value))}
                        className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        {DOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
            )}

            {/* Monthly: day-of-month picker */}
            {value?.freq === 'monthly' && (
                <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Day of month <span className="font-normal normal-case">(1–28)</span>
                    </label>
                    <input
                        type="number"
                        min={1}
                        max={28}
                        value={value.dayOfMonth ?? 1}
                        onChange={e => handleDayOfMonth(Number(e.target.value))}
                        className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
            )}

            {/* End date (all non-none frequencies) */}
            {value && (
                <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        End date <span className="font-normal normal-case">(optional)</span>
                    </label>
                    <input
                        type="date"
                        value={value.endDate ?? ''}
                        onChange={e => handleEndDate(e.target.value)}
                        className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
            )}

            {/* Summary */}
            {value && (
                <p className="text-xs text-muted-foreground">
                    Repeats: <span className="font-medium text-foreground">{describeRecurrence(value)}</span>
                    {value.endDate && ` · until ${new Date(value.endDate + 'T00:00:00').toLocaleDateString()}`}
                </p>
            )}
        </div>
    );
}
