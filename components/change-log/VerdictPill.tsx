import { ArrowDown, ArrowUp, Clock, Minus } from 'lucide-react';

import { resultLabel, type Verdict } from '@/lib/change-log/types';

function badgeClass(verdict: Verdict): string {
    if (verdict === 'improved') return 'bg-green-50 text-green-800 ring-green-600/20';
    if (verdict === 'declined') return 'bg-red-50 text-red-800 ring-red-600/20';
    if (verdict === 'flat') return 'bg-zinc-100 text-zinc-700 ring-zinc-500/20';
    return 'bg-amber-50 text-amber-900 ring-amber-600/20';
}

function VerdictMark({ verdict, estimate }: { verdict: Verdict; estimate: boolean }) {
    if (estimate) return <span aria-hidden="true">~</span>;
    const Icon = verdict === 'improved' ? ArrowUp : verdict === 'declined' ? ArrowDown : verdict === 'flat' ? Minus : Clock;
    return <Icon aria-hidden="true" className="h-3 w-3" />;
}

/** One result: words plus an icon. Color is never the only signal. */
export function VerdictPill({ verdict, estimate }: { verdict: Verdict; estimate: boolean }) {
    const label = resultLabel(verdict, estimate);
    const className = estimate
        ? 'border border-dashed border-amber-600 text-amber-900'
        : `ring-1 ring-inset ${badgeClass(verdict)}`;
    return (
        <span data-result={estimate ? 'early-estimate' : verdict} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
            <VerdictMark verdict={verdict} estimate={estimate} />
            {label}
        </span>
    );
}
