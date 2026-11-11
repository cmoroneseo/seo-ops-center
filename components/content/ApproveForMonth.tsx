import { Check, Loader2 } from 'lucide-react';

import { QuotaBar } from '@/components/content/QuotaBar';
import type { ContentQuota } from '@/lib/content/quota';
import { workMonthLabel } from '@/lib/topical-map/production';

export function ApproveForMonth({
    month,
    months,
    quota,
    disabled,
    busy,
    onMonth,
    onApprove,
}: {
    month: string;
    months: string[];
    quota: ContentQuota;
    disabled: boolean;
    busy: boolean;
    onMonth: (month: string) => void;
    onApprove: () => void;
}) {
    const label = workMonthLabel(month) ?? 'this month';
    const locked = disabled || busy;
    return (
        <div className="space-y-2">
            <label htmlFor="approve-for-month" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Month
            </label>
            <select
                id="approve-for-month"
                value={months.includes(month) ? month : months[0] ?? ''}
                disabled={locked || months.length === 0}
                onChange={event => onMonth(event.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            >
                {months.map(value => (
                    <option key={value} value={value}>{workMonthLabel(value)}</option>
                ))}
            </select>
            <QuotaBar quota={quota} warningId="approve-month-warning" allowAnyway />
            <button
                type="button"
                data-approve-for={month}
                aria-describedby={quota.warning ? 'approve-month-warning' : undefined}
                onClick={onApprove}
                disabled={locked || !month}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve for {label}
            </button>
        </div>
    );
}
