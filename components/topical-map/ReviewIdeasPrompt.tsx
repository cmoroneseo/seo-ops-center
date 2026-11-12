import { ListChecks } from 'lucide-react';

/** Shown on the topic map while ideas are still waiting for a decision. */
export function ReviewIdeasPrompt({ waiting, total, onReview }: { waiting: number; total: number; onReview: () => void }) {
    if (waiting <= 0) return null;
    return (
        <div
            data-review-prompt={waiting}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-[#bae6fd] bg-[#f0f9ff] px-4 py-3 text-[#0c4a6e] dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
        >
            <ListChecks className="h-5 w-5 shrink-0 text-[#0369a1] dark:text-sky-300" aria-hidden />
            <p className="min-w-0 flex-1 text-[13.5px]">
                <b>{waiting} of {total} topic {total === 1 ? 'idea is' : 'ideas are'} waiting for review.</b>{' '}
                Approve the ones worth writing so they join the content plan.
            </p>
            <button
                type="button"
                onClick={onReview}
                className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#18181b] bg-[#18181b] px-3.5 text-[13.5px] font-semibold text-white hover:bg-[#27272a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] focus-visible:ring-offset-2"
            >
                Review topic ideas
            </button>
        </div>
    );
}
