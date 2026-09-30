'use client';

import Link from 'next/link';
import { FeedbackThread } from './FeedbackThread';
import type { PortalFeedbackEntry, PortalPendingItem } from '@/lib/portal/progress';

export function PortalPending({
    items,
    feedback,
    planId,
}: {
    items: PortalPendingItem[];
    feedback: PortalFeedbackEntry[];
    planId?: string;
}) {
    if (items.length === 0) {
        return (
            <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-xl font-semibold">Nothing is waiting on you</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                    When the team needs a decision, or a piece of content is ready to review, it will show up here.
                </p>
            </div>
        );
    }

    return (
        <ul className="space-y-4">
            {items.map(item => {
                const thread = item.kind === 'plan' && planId
                    ? feedback.filter(entry => entry.subjectType === 'plan' && entry.subjectId === planId)
                    : item.kind === 'waiting_item'
                        ? feedback.filter(entry => entry.subjectType === 'waiting_item' && entry.subjectId === item.id)
                        : [];
                return (
                    <li id={item.kind === 'waiting_item' ? `waiting-${item.id}` : undefined} key={`${item.kind}-${item.id}`} className="rounded-xl border border-border bg-card p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {item.kind === 'plan' ? 'SEO Plan' : item.kind === 'content_review' ? 'Content review' : 'Waiting on you'}
                        </p>
                        <h2 className="mt-1 text-lg font-semibold">{item.title}</h2>
                        {item.detail && <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>}
                        <div className="mt-3">
                            {item.external ? (
                                <a href={item.href} className="text-sm font-medium text-primary hover:underline">Open content review</a>
                            ) : item.kind === 'plan' ? (
                                <Link href={item.href} className="text-sm font-medium text-primary hover:underline">Review the SEO Plan</Link>
                            ) : null}
                        </div>
                        {item.kind === 'plan' && planId && (
                            <FeedbackThread subjectType="plan" subjectId={planId} entries={thread} />
                        )}
                        {item.kind === 'waiting_item' && (
                            <FeedbackThread subjectType="waiting_item" subjectId={item.id} entries={thread} />
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
