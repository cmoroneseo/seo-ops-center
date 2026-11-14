'use client';

import { useState, type ReactNode } from 'react';
import { Check, ImageIcon, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { diffWords } from '@/lib/gbp-approvals/diff';
import { cn } from '@/lib/utils';

import { LOGO, SAMPLE_POSTS, SAMPLE_QUESTIONS, monthDay, weekday, type SamplePost } from './sample';

export type AgencyView = 'status' | 'share' | 'revision' | 'history';

/**
 * Agency approvals on the staff canvas: white cards on the light page,
 * inside the black sidebar. Status colors are the same emerald, amber,
 * and zinc badges used on other staff pages, darkened so the text clears
 * AA on the tinted chip.
 */
export function AgencyStatus({ view = 'status' }: { view?: AgencyView }) {
    const [selected, setSelected] = useState(2);
    const [accepted, setAccepted] = useState(false);
    const [note, setNote] = useState('Removed the leftovers line, as you suggested.');
    const [toast, setToast] = useState<string | null>(null);
    const post = SAMPLE_POSTS.find(item => item.position === selected) ?? SAMPLE_POSTS[1];

    return (
        <div className="mx-auto max-w-6xl space-y-6 text-foreground">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-sm text-muted-foreground">Tasks / ALL-IN-1 Construction / GBP holiday posts</p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight">GBP holiday posts: free walkthrough offer (7 posts)</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>ALL-IN-1 Construction</span>
                        <span>Due Sun, Nov 15</span>
                        <StatusChip kind="changes">Changes requested</StatusChip>
                    </div>
                </div>
                <Button variant="outline" type="button">Open as client</Button>
            </header>

            {view === 'share' && <SharePanel onExtend={() => setToast('Extended 14 days on the same link.')} />}
            {view === 'history' && <HistoryPanel accepted={accepted} />}
            {view === 'revision' && (
                <RevisionPanel
                    accepted={accepted}
                    note={note}
                    onNote={setNote}
                    onAccept={() => { setAccepted(true); setToast('Suggestion accepted into v2. Nothing was sent.'); }}
                />
            )}
            {view === 'status' && (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Count label="Approved" value="4" />
                        <Count label="Changes requested" value="2" />
                        <Count label="Pending" value="1" />
                        <Count label="Questions answered" value="1 / 3" />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
                        <p className="text-muted-foreground">Link active · expires Fri, Nov 27 · 3 views · last opened Sat Nov 14, 9:12 AM PT. This is the same link.</p>
                        <Button variant="outline" type="button" onClick={() => setToast('Extended 14 days on the same link.')}>Extend 14 days</Button>
                    </div>
                    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
                        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                            {SAMPLE_POSTS.map(item => (
                                <li key={item.position}>
                                    <button
                                        type="button"
                                        onClick={() => setSelected(item.position)}
                                        className={cn(
                                            'flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-muted',
                                            item.position === selected && 'bg-muted',
                                        )}
                                    >
                                        <Thumb post={item} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-semibold">Post {item.position} · Planned for {weekday(item.scheduled)}</span>
                                            <span className="mt-0.5 block text-sm text-muted-foreground">{item.title}</span>
                                            {!item.photo && <StatusChip kind="photo" className="mt-2">Photo needed</StatusChip>}
                                        </span>
                                        <ItemStatus status={item.status} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <PostSummary post={post} />
                    </div>
                </>
            )}
            {toast && <p className="fixed bottom-24 right-4 z-50 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-lg lg:bottom-6" role="status">{toast}</p>}
        </div>
    );
}

function SharePanel({ onExtend }: { onExtend: () => void }) {
    return (
        <section className="max-w-2xl space-y-4 rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Share link</h2>
            <p className="text-sm text-muted-foreground">Nothing is sent. The client opens this same link. Extend keeps the link they already have.</p>
            <label className="block text-sm font-medium" htmlFor="share-url">Review link</label>
            <input id="share-url" readOnly className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" value="https://seo-ops-center.vercel.app/r/sample-link" />
            <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={onExtend}>Extend 14 days</Button>
                <Button type="button" variant="outline">Copy link</Button>
                <Button type="button" variant="outline">Revoke</Button>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">Active</dd></div>
                <div><dt className="text-muted-foreground">Expires</dt><dd className="font-medium">Fri, Nov 27</dd></div>
                <div><dt className="text-muted-foreground">Opened</dt><dd className="font-medium">3 views</dd></div>
            </dl>
        </section>
    );
}

function HistoryPanel({ accepted }: { accepted: boolean }) {
    const rows = [
        ['v1 sent', '7 posts, 3 questions · Fri Nov 13, 7:05 PM PT'],
        ['Client feedback', '4 approved, 2 changes, 1 not reviewed · Sat Nov 14, 9:41 AM PT'],
        ['v2', accepted ? 'Post 2 suggestion accepted. Send the revision when the note is ready.' : 'Not posted yet. Accept the suggestion or edit by hand.'],
    ];
    return (
        <section className="max-w-2xl rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Revision history</h2>
            <ol className="mt-4 space-y-4 border-l border-border pl-4">
                {rows.map(([label, detail]) => (
                    <li key={label}>
                        <p className="text-sm font-semibold">{label}</p>
                        <p className="mt-1 block text-sm text-muted-foreground">{detail}</p>
                    </li>
                ))}
            </ol>
            <p className="mt-4 text-sm text-muted-foreground">Approval does not change the planned date. When every post is approved, the task moves to In Progress.</p>
        </section>
    );
}

function RevisionPanel({
    accepted, note, onNote, onAccept,
}: {
    accepted: boolean;
    note: string;
    onNote: (value: string) => void;
    onAccept: () => void;
}) {
    const post = SAMPLE_POSTS[1];
    const parts = diffWords(post.previousBody ?? '', post.suggestedBody ?? '');
    return (
        <section className="max-w-3xl space-y-4 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Post 2 · Planned for {weekday(post.scheduled)}</h2>
                <StatusChip kind="changes">Changes requested</StatusChip>
            </div>
            <p className="text-sm text-muted-foreground">Client reviewer · Sample</p>
            <p>{post.comment}</p>
            <h3 className="text-sm font-semibold">Suggested edit</h3>
            <p className="rounded-lg border border-border bg-muted p-3 text-sm leading-7">
                {parts.map((part, index) => part.kind === 'same'
                    ? <span key={index}>{part.text}</span>
                    : <span key={index} className={part.kind === 'removed' ? 'rounded bg-red-50 text-red-900 line-through' : 'rounded bg-emerald-50 text-emerald-950 underline'}>{part.text}</span>)}
            </p>
            <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={onAccept} disabled={accepted}>{accepted ? 'Accepted into v2' : 'Accept into v2'}</Button>
                <Button type="button" variant="outline">Dismiss suggestion</Button>
            </div>
            <label className="block text-sm font-medium" htmlFor="change-note">Change note the client will see</label>
            <textarea id="change-note" className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" value={note} onChange={event => onNote(event.target.value)} />
            <p className="text-sm text-muted-foreground">Sending the revision updates this same link. Nothing is emailed or posted to Basecamp.</p>
        </section>
    );
}

function PostSummary({ post }: { post: SamplePost }) {
    return (
        <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-base font-semibold">Post {post.position} · Planned for {weekday(post.scheduled)}</h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
                {post.photo ? <img src={post.photo} alt="" className="aspect-[4/3] w-full object-cover" /> : (
                    <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 bg-muted text-amber-950">
                        <ImageIcon className="h-8 w-8" aria-hidden="true" />
                        <span className="text-sm font-semibold">Photo needed</span>
                    </div>
                )}
                <div className="space-y-1 p-3">
                    <div className="flex items-center gap-2">
                        <img src={LOGO} alt="" className="h-8 w-8 rounded-full object-contain" />
                        <div>
                            <p className="text-sm font-semibold">ALL-IN-1 Construction</p>
                            <p className="text-xs text-muted-foreground">Planned for {weekday(post.scheduled)}</p>
                        </div>
                    </div>
                    <p className="font-semibold">{post.title}</p>
                    <p className="text-sm text-muted-foreground">{monthDay(post.offerStart)} – {monthDay(post.offerEnd)}</p>
                    <p className="text-sm">{post.body}</p>
                </div>
            </div>
        </section>
    );
}

function Thumb({ post }: { post: SamplePost }) {
    if (post.photo) return <img src={post.photo} alt="" className="h-14 w-[4.5rem] shrink-0 rounded-md border border-border object-cover" />;
    return (
        <span className="flex h-14 w-[4.5rem] shrink-0 items-center justify-center rounded-md border border-dashed border-amber-800 bg-amber-50 text-amber-950" aria-hidden="true">
            <ImageIcon className="h-5 w-5" />
        </span>
    );
}

export function ItemStatus({ status }: { status: SamplePost['status'] }) {
    if (status === 'approved') return <StatusChip kind="approved"><Check className="h-3.5 w-3.5" aria-hidden="true" />Approved</StatusChip>;
    if (status === 'changes_requested') return <StatusChip kind="changes"><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Changes requested</StatusChip>;
    return <StatusChip kind="pending">Pending</StatusChip>;
}

function StatusChip({ kind, className, children }: { kind: 'approved' | 'changes' | 'pending' | 'photo'; className?: string; children: ReactNode }) {
    const tone = {
        approved: 'border-emerald-800 bg-emerald-50 text-emerald-950',
        changes: 'border-amber-900 bg-amber-50 text-amber-950',
        pending: 'border-zinc-600 bg-zinc-100 text-zinc-900',
        photo: 'border-amber-900 bg-amber-50 text-amber-950',
    }[kind];
    return <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold', tone, className)}>{children}</span>;
}

function Count({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-2xl font-semibold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
        </div>
    );
}
