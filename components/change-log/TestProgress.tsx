import { TEST_PROGRESS_STATUS_LABEL, testProgress } from '@/lib/change-log/progress';
import { formatDayWithYear } from '@/lib/change-log/time';

/** Compact semi-circle. Zinc only, so it sits with the other change cards. */
function Gauge({ percent }: { percent: number }) {
    const radius = 52;
    const length = Math.PI * radius;
    const filled = (Math.min(100, Math.max(0, percent)) / 100) * length;
    return (
        <svg viewBox="0 0 140 78" className="h-24 w-40" role="img" aria-label={`${percent} percent`}>
            <path d="M 16 68 A 52 52 0 0 1 124 68" fill="none" stroke="#e4e4e7" strokeWidth="10" strokeLinecap="round" />
            {percent > 0 && (
                <path
                    d="M 16 68 A 52 52 0 0 1 124 68"
                    fill="none"
                    stroke="#18181b"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${filled} ${length}`}
                />
            )}
            <text x="70" y="64" textAnchor="middle" fill="#18181b" fontSize="22" fontWeight="600">{percent}%</text>
        </svg>
    );
}

export function TestProgressCard({ liveOn, finalThrough }: { liveOn: string; finalThrough: string }) {
    const progress = testProgress(liveOn, finalThrough);
    if (!progress) return null;
    const status = TEST_PROGRESS_STATUS_LABEL[progress.status];
    return (
        <section
            className="rounded-lg border border-border bg-card p-4"
            data-test-progress={progress.percent}
            data-test-progress-status={progress.status}
            data-test-progress-window={progress.targetDays}
            data-test-progress-final={progress.finalThrough}
        >
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium">Test progress</h3>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{status}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Progress through the current measurement window.</p>
                    <p className="mt-2 text-xs text-muted-foreground">{progress.targetDays}-day check</p>
                    <p className="mt-1 text-xs text-muted-foreground">Numbers are final through {formatDayWithYear(progress.finalThrough)}.</p>
                    {progress.finalDays === 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">No final days after this went live yet.</p>
                    )}
                </div>
                <Gauge percent={progress.percent} />
            </div>
        </section>
    );
}

/** Quiet bar for a list row. The number stays in the accessible name, not in the cell. */
export function ProgressMark({
    percent,
    status,
}: {
    percent: number | null | undefined;
    status?: 'in_progress' | 'finished' | null;
}) {
    if (percent == null || !Number.isFinite(percent)) return null;
    const clamped = Math.min(100, Math.max(0, percent));
    const words = status === 'finished' ? 'Finished' : 'In progress';
    return (
        <span
            className="mt-1.5 block h-1 w-10 overflow-hidden rounded-full bg-zinc-200"
            data-progress={clamped}
            data-progress-status={status ?? 'in_progress'}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clamped}
            aria-label={`Test progress ${clamped} percent. ${words}.`}
        >
            <span className="block h-full bg-zinc-800" style={{ width: `${clamped}%` }} />
        </span>
    );
}
