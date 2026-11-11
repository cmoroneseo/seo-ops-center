import { cn } from '@/lib/utils';
import type { ContentQuota } from '@/lib/content/quota';

export function QuotaBar({
    quota,
    warningId,
    allowAnyway = false,
}: {
    quota: ContentQuota;
    warningId?: string;
    allowAnyway?: boolean;
}) {
    const ratio = quota.limit == null
        ? 0
        : quota.limit === 0
            ? (quota.planned > 0 ? 1 : 0)
            : Math.min(quota.planned / quota.limit, 1);
    return (
        <div data-quota-bar className="min-w-0">
            <p
                className="text-sm font-medium text-foreground"
                title={quota.limit == null ? 'No monthly content plan is saved for this client.' : undefined}
            >
                {quota.label}
            </p>
            {quota.limit != null && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                        className={cn('h-full rounded-full', quota.warning ? 'bg-amber-500' : 'bg-primary')}
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                </div>
            )}
            {quota.warning && (
                <p id={warningId} role="status" data-quota-warning className="mt-1.5 text-sm text-amber-700">
                    {quota.warning}
                    {allowAnyway ? ' You can still approve this page.' : ''}
                </p>
            )}
        </div>
    );
}
