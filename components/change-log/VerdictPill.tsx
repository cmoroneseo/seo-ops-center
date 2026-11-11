import { ArrowDown, ArrowUp, Clock, Minus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { formatHeadlinePct } from '@/lib/change-log/list';
import { resultLabel, type Verdict } from '@/lib/change-log/types';
import { cn } from '@/lib/utils';

function tone(verdict: Verdict): string {
    if (verdict === 'improved') return 'border-transparent bg-green-50 text-green-800 ring-1 ring-inset ring-green-600/20';
    if (verdict === 'declined') return 'border-transparent bg-red-50 text-red-800 ring-1 ring-inset ring-red-600/20';
    if (verdict === 'flat') return 'border-transparent bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-500/20';
    return 'border-transparent bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-600/20';
}

function VerdictMark({ verdict, estimate }: { verdict: Verdict; estimate: boolean }) {
    if (estimate) return <span aria-hidden="true">~</span>;
    const Icon = verdict === 'improved' ? ArrowUp : verdict === 'declined' ? ArrowDown : verdict === 'flat' ? Minus : Clock;
    return <Icon aria-hidden="true" />;
}

/** One result: words plus an icon. The percent is included only when that check is ready. */
export function VerdictPill({
    verdict,
    estimate,
    pct = null,
}: {
    verdict: Verdict;
    estimate: boolean;
    pct?: number | null;
}) {
    const label = resultLabel(verdict, estimate);
    const pctText = formatHeadlinePct(pct);
    return (
        <Badge
            variant="outline"
            data-result={estimate ? 'early-estimate' : verdict}
            className={cn(
                'gap-1 px-2 py-0.5 font-medium',
                estimate ? 'border-dashed border-amber-600 bg-transparent text-amber-900' : tone(verdict),
            )}
        >
            <VerdictMark verdict={verdict} estimate={estimate} />
            {pctText ? `${label} ${pctText}` : label}
        </Badge>
    );
}
