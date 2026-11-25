'use client';

import React, { useRef, useState, type FormEvent } from 'react';
import { GbpPostPreview, previewPhotos } from '@/components/gbp-approvals/GbpPostPreview';
import { PhotoCommentTarget, usePhotoCommentTarget } from '@/components/gbp-approvals/PhotoCommentTarget';
import { UNAVAILABLE_REVIEW, feedbackLabel, reviewDecisions, type InternalReviewPost, type InternalReviewView } from '@/lib/internal-review/model';

const field = 'w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';

export function InternalReview({ view, token }: { view: InternalReviewView | null; token?: string }) {
    const [reviewerName, setReviewerName] = useState('');
    if (!view) return (
        <main className="grid min-h-svh place-items-center bg-[#f4f6f5] p-5 text-slate-950">
            <h1 className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-xl font-semibold shadow-sm">{UNAVAILABLE_REVIEW}</h1>
        </main>
    );

    return (
        <main className="min-h-svh bg-[#f4f6f5] text-slate-950">
            <header className="bg-[#123331] text-white">
                <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
                    <p className="text-sm font-semibold text-teal-100">Internal review</p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{view.clientName}</h1>
                    <p className="mt-3 max-w-xl text-sm text-teal-50 sm:text-base">Review these Google Business Profile drafts before they go to the client.</p>
                </div>
            </header>
            <div className="mx-auto max-w-5xl space-y-10 px-5 pt-7 pb-12 sm:px-8">
                {view.batches.map(batch => (
                    <section className="space-y-4" key={batch.posts[0].itemId}>
                        <h2 className="text-xl font-semibold tracking-tight">{batch.title}</h2>
                        {batch.posts.map(post => (
                            <ReviewPost key={post.versionId} post={post} clientName={view.clientName} token={token} reviewerName={reviewerName} onNameChange={setReviewerName} />
                        ))}
                    </section>
                ))}
            </div>
        </main>
    );
}

function ReviewPost({ post, clientName, token, reviewerName, onNameChange }: {
    post: InternalReviewPost;
    clientName: string;
    token?: string;
    reviewerName: string;
    onNameChange: (name: string) => void;
}) {
    const [decision, setDecision] = useState<keyof typeof reviewDecisions>('approved');
    const [comments, setComments] = useState<Record<number, string>>({});
    const [feedback, setFeedback] = useState(post.feedback);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const lastAttempt = useRef<{ body: string; key: string } | null>(null);
    const sources = previewPhotos({ photo: post.photoSrc, photoSrcs: post.photoSrcs });
    const target = usePhotoCommentTarget(sources);
    const { photoPosition } = target;
    const commentKey = photoPosition ?? 0;
    const commentRequired = decision !== 'approved' || photoPosition !== null;

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!token || busy) return;
        const entry = {
            reviewerName: reviewerName.trim(),
            decision: decision === 'comment' ? null : decision,
            comment: comments[commentKey]?.trim() || null,
            photoPosition,
        };
        const body = JSON.stringify(entry);
        if (lastAttempt.current?.body !== body) lastAttempt.current = { body, key: crypto.randomUUID() };
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const response = await fetch(`/api/public/internal-review/${encodeURIComponent(token)}/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...entry, itemId: post.itemId, versionId: post.versionId, idempotencyKey: lastAttempt.current.key }),
            });
            const result = await response.json();
            if (!response.ok) {
                setError(result.error ?? 'Feedback could not be saved.');
                return;
            }
            setFeedback(previous => [...previous, entry]);
            lastAttempt.current = null;
            setComments(current => ({ ...current, [commentKey]: '' }));
            setDecision('approved');
            target.selectTarget(null);
            setNotice('Feedback saved.');
        } catch {
            setError('Feedback could not be saved. Try again.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,420px)_minmax(0,1fr)] sm:p-6">
                <div className="min-w-0 space-y-2">
                    <p className="text-sm font-medium text-teal-800">Post {post.position}</p>
                    <GbpPostPreview post={{ ...post, scheduled: post.scheduledDate, ctaLabel: post.ctaLabel || (post.ctaUrl ? 'Open link' : '') }}
                        sources={sources} clientName={clientName} ctaHref={post.ctaUrl}
                        photoIndex={target.photoIndex} onPhotoChange={target.selectSlide} />
                </div>
                {(post.terms || post.ctaUrl) && <div className="min-w-0 space-y-3 text-sm text-slate-700 sm:pt-7">
                    {post.terms && <p className="whitespace-pre-wrap wrap-break-word">{post.terms}</p>}
                    {post.ctaUrl && <p className="wrap-anywhere">{post.ctaUrl}</p>}
                </div>}
            </div>
            <div className="space-y-4 border-t border-slate-200 bg-[#fafcfb] p-5 sm:p-6">
                {feedback.length > 0 && (
                    <ul className="space-y-2" aria-label="Internal feedback">
                        {feedback.map((entry, index) => (
                            <li className="rounded-lg border border-slate-200 bg-white p-3 text-sm wrap-break-word" key={index}>
                                <p><strong>{entry.reviewerName}</strong> · {feedbackLabel(entry.decision)}{entry.photoPosition && ` · Photo ${entry.photoPosition}`}</p>
                                {entry.comment && <p className="mt-1 whitespace-pre-wrap text-slate-700">{entry.comment}</p>}
                            </li>
                        ))}
                    </ul>
                )}
                <form method="post" onSubmit={submit} className="space-y-3" aria-label={`Feedback for post ${post.position}`}>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-1 text-sm font-medium">
                            Your name
                            <input className={field} autoComplete="name" required maxLength={120} value={reviewerName} onChange={event => onNameChange(event.target.value)} />
                        </label>
                        <label className="grid gap-1 text-sm font-medium">
                            Decision
                            <select className={field} value={decision} onChange={event => setDecision(event.target.value as keyof typeof reviewDecisions)}>
                                {Object.entries(reviewDecisions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                        </label>
                    </div>
                    {sources.some(Boolean) && <PhotoCommentTarget sources={sources} value={photoPosition} onChange={target.selectTarget}
                        className="grid gap-1 text-sm font-medium" fieldClassName={field} />}
                    <label className="grid gap-1 text-sm font-medium">
                        {commentRequired ? 'Comment' : 'Comment (optional)'}
                        <textarea className={field} name="comment" rows={2} maxLength={4000} required={commentRequired}
                            value={comments[commentKey] ?? ''} onChange={event => {
                                const value = event.target.value;
                                setComments(current => ({ ...current, [commentKey]: value }));
                            }} />
                    </label>
                    <button disabled={!token || busy} className="min-h-10 rounded-lg bg-[#123331] px-4 text-sm font-semibold text-white hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50">
                        {busy ? 'Saving…' : 'Save internal feedback'}
                    </button>
                    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
                    {notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
                </form>
            </div>
        </article>
    );
}
