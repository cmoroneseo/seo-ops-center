'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';

import { diffWords } from '@/lib/gbp-approvals/diff';

import './public-review.css';
import { monthDay, weekday, type SamplePost } from './sample';

export interface ReviewQuestion {
    id: string;
    prompt: string;
    about: string;
    answer: string | null;
}

export interface ReviewPost extends SamplePost {
    itemId?: string;
    versionId?: string;
    locked?: boolean;
    terms?: string;
    ctaUrl?: string;
    ctaLabel?: string;
    changeNote?: string | null;
    postType?: string;
}

const NO_QUESTIONS: ReviewQuestion[] = [];

type Mode = 'review' | 'revision' | 'expired' | 'revoked' | 'missing';

function Check() {
    return <svg className="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

export function PublicReview({
    mode,
    posts,
    questions = NO_QUESTIONS,
    clientName: clientNameProp,
    logoSrc,
    token, expiresAt, dueAt,
}: {
    mode: Mode;
    posts: ReviewPost[];
    questions?: ReviewQuestion[];
    clientName?: string;
    logoSrc?: string;
    token?: string;
    expiresAt?: string | null;
    dueAt?: string | null;
}) {
    const [choices, setChoices] = useState<Record<number, 'approved' | 'changes_requested' | undefined>>({});
    const [openChanges, setOpenChanges] = useState<number | null>(null);
    const [comments, setComments] = useState<Record<number, string>>({});
    const [suggestions, setSuggestions] = useState<Record<number, { title?: string; body?: string }>>({});
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [full, setFull] = useState<Record<number, boolean>>({});
    const [askName, setAskName] = useState(false);
    const [name, setName] = useState('');
    const [nameError, setNameError] = useState(false);
    const [sent, setSent] = useState(false);
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [uploads, setUploads] = useState<Record<number, string>>({});
    const [uploading, setUploading] = useState(false);
    const attempt = useRef<{ key: string; payload: string } | null>(null);
    const clientName = clientNameProp?.trim() || 'your business';

    const counts = useMemo(() => {
        const approved = posts.filter(post => (choices[post.position] ?? (mode === 'revision' ? post.status : undefined)) === 'approved').length;
        const changes = posts.filter(post => (choices[post.position] ?? (mode === 'revision' ? post.status : undefined)) === 'changes_requested').length;
        const pending = posts.length - approved - changes;
        const answered = questions.filter(question => (answers[question.id] ?? question.answer ?? '').trim()).length;
        return { approved, changes, pending, answered };
    }, [answers, choices, mode, posts, questions]);

    if (mode === 'missing') {
        return (
            <Shell>
                <section className="panel">
                    <h1 className="title">{'This link isn\u2019t available'}</h1>
                    <p className="lead">Check the link you were given, or contact your account manager.</p>
                </section>
            </Shell>
        );
    }
    if (mode === 'expired' || mode === 'revoked') {
        return (
            <Shell>
                <section className="panel">
                    <h1 className="title">{mode === 'expired' ? 'This review link has expired' : 'This review link was turned off'}</h1>
                    <p className="lead">
                        {mode === 'expired'
                            ? `${expiresAt ? `It expired on ${new Date(expiresAt).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'America/Los_Angeles' })}. ` : 'This link has expired. '}Contact your account manager at Marketing Empire Group for a new one.`
                            : 'Marketing Empire Group turned this link off. Contact your account manager if you still need to review these posts.'}
                    </p>
                </section>
            </Shell>
        );
    }

    if (sent) {
        return (
            <Shell clientName={clientName} logoSrc={logoSrc} active>
                <section className="panel">
                    <div className="done-ic" aria-hidden="true"><Check /></div>
                    <h1 className="title">Thanks, {name.trim()}. We have your review.</h1>
                    <p className="lead">Your account manager will schedule the approved posts and follow up on any changes. You can reopen this page until the link expires.</p>
                </section>
            </Shell>
        );
    }

    const updated = mode === 'revision' ? posts.filter(post => post.previousBody || post.replacementPhoto) : [];

    const kept = mode === 'revision' ? posts.filter(post => post.status === 'approved' && !post.previousBody) : [];

    function approveAll() {
        const next: Record<number, 'approved'> = {};
        for (const post of posts) if (!post.locked) next[post.position] = 'approved';
        setChoices(next);
    }

    async function upload(post: ReviewPost, file: File) {
        if (!token || uploading || busy) return;
        setUploading(true);
        setError('');
        try {
            const response = await fetch(`/api/public/approvals/${encodeURIComponent(token)}/photo-upload-url`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contentType: file.type, byteSize: file.size }),
            });
            const result = await response.json();
            if (response.status !== 200) throw new Error(result.error || 'Photo upload could not be started.');
            const uploaded = await fetch(result.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
            if (!uploaded.ok) throw new Error('Photo upload failed. Please try again.');
            setUploads(current => ({ ...current, [post.position]: result.reservationId }));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Photo upload failed. Please try again.');
        } finally {
            setUploading(false);
        }
    }

    async function send() {
        if (busy || uploading) return;
        if (!name.trim()) {
            setNameError(true);
            return;
        }
        if (posts.some(post => !post.locked && choices[post.position] === 'changes_requested' && !comments[post.position]?.trim())) {
            setError('A comment is required for each post requesting changes.');
            return;
        }
        setError('');
        setBusy(true);
        try {
            if (!token) throw new Error('This preview cannot save a review. Open your review link.');
            const payload = {
                respondentName: name.trim(), respondentEmail: email.trim() || null,
                displayedVersionIds: posts.map(post => post.versionId),
                decisions: posts.filter(post => !post.locked && choices[post.position]).map(post => ({
                    itemId: post.itemId, versionId: post.versionId, decision: choices[post.position],
                    comment: choices[post.position] === 'changes_requested' ? comments[post.position] ?? '' : '',
                    suggestedTitle: choices[post.position] === 'changes_requested' && suggestions[post.position]?.title !== undefined && suggestions[post.position].title !== post.title ? suggestions[post.position].title : undefined,
                    suggestedBody: choices[post.position] === 'changes_requested' && suggestions[post.position]?.body !== undefined && suggestions[post.position].body !== post.body ? suggestions[post.position].body : undefined,
                    reservationId: choices[post.position] === 'changes_requested' ? uploads[post.position] : undefined,
                })),
                answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer })),
            };
            const serialized = JSON.stringify(payload);
            if (!attempt.current || attempt.current.payload !== serialized) attempt.current = { key: crypto.randomUUID(), payload: serialized };
            const response = await fetch(`/api/public/approvals/${encodeURIComponent(token)}/submit`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, idempotencyKey: attempt.current.key }),
            });
            const result = await response.json();
            if (response.status !== 200) throw new Error(result.error || 'Your review could not be saved. Please try again.');
            attempt.current = null;
            setSent(true);
            setAskName(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Your review could not be saved. Please try again.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Shell clientName={clientName} logoSrc={logoSrc} active>
            {error && <p className="errmsg" role="alert">{error}</p>}
            <div className="wrap">
                <div>
                    {mode === 'revision' && (
                        <div className="notice" role="status">
                            <span><b>Revision ready.</b> {updated.length === 1 ? '1 post was' : `${updated.length} posts were`} updated for you. Nothing new was sent. You are on the same link.</span>
                        </div>
                    )}
                    {mode === 'review' && (
                        <section className="panel">
                            <h1 className="title">Review your Google posts</h1>
                            <p className="lead">Marketing Empire Group drafted {posts.length} Google Business Profile offer posts for {clientName}. Approve each one, or tell us what to change.</p>
                            <div className="facts">
                                <span>{posts.length} posts</span>
                                <span>{questions.length} questions</span>
                                {dueAt && <span>Please review by {new Date(dueAt).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })}</span>}
                            </div>
                            <ol className="steps">
                                <li>Read each post as it will look on Google</li>
                                <li>Approve it or request changes</li>
                                <li>Answer the questions</li>
                                <li>Add your name and send</li>
                            </ol>
                            <div className="notice"><span><b>Happy with all of them?</b> Approve all {posts.length} at once. You can still change any post before you send. Posts without a photo still need one.</span></div>
                            <button className="btn btn-secondary" style={{ marginTop: 12 }} type="button" onClick={approveAll}><Check />Approve all {posts.length} posts</button>
                        </section>
                    )}
                    {mode === 'review' && (
                        <section className="panel" aria-labelledby="questions-heading">
                            <h2 id="questions-heading" style={{ fontSize: 22, lineHeight: '30px' }}>{questions.length} questions from Marketing Empire Group</h2>
                            <p className="hint" style={{ marginTop: 4 }}>Answer what you can. These help us get the details right.</p>
                            {questions.map(question => (
                                <div className="qcard" key={question.id}>
                                    <div className="q"><span>{question.prompt}</span></div>
                                    <div className="about">About: {question.about}</div>
                                    <div className="field">
                                        <label className="label" htmlFor={question.id}>Your answer <span className="lopt">(optional)</span></label>
                                        <textarea className="input ta" id={question.id} value={answers[question.id] ?? question.answer ?? ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} />
                                    </div>
                                </div>
                            ))}
                        </section>
                    )}
                    <div className="sec-h"><h2>{mode === 'revision' ? 'Updated posts' : `Your ${posts.length} posts`}</h2></div>
                    {(mode === 'revision' ? posts.filter(post => !kept.includes(post)) : posts).map(post => (
                        <PostCard
                            key={post.position}
                            post={post}
                            total={posts.length}
                            clientName={clientName}
                            logoSrc={logoSrc}
                            onUpload={file => upload(post, file)}
                            uploading={uploading || busy}
                            uploaded={Boolean(uploads[post.position])}
                            choice={choices[post.position]}
                            open={openChanges === post.position}
                            comment={comments[post.position] ?? ''}
                            suggestedTitle={suggestions[post.position]?.title ?? post.title}
                            suggestedBody={suggestions[post.position]?.body ?? post.body}
                            onSuggest={(field, value) => setSuggestions(current => ({ ...current, [post.position]: { ...current[post.position], [field]: value } }))}
                            showFull={full[post.position] === true}
                            onApprove={() => setChoices(current => ({ ...current, [post.position]: 'approved' }))}
                            onRequest={() => { setOpenChanges(post.position); setChoices(current => ({ ...current, [post.position]: 'changes_requested' })); }}
                            onComment={value => setComments(current => ({ ...current, [post.position]: value }))}
                            onToggleFull={() => setFull(current => ({ ...current, [post.position]: !current[post.position] }))}
                        />
                    ))}
                    {mode === 'revision' && kept.length > 0 && <h2 style={{ marginTop: 28 }}>Already approved</h2>}
                    {kept.map(post => (
                        <article className="ritem" key={post.position}><div className="collapsed"><div className="t">Post {post.position} <span>{post.title}</span></div><span className="chip chip-approved">Approved</span></div></article>
                    ))}
                </div>
                <aside className="side">
                    <section className="panel">
                        <h2>Your review</h2>
                        <div className="prog" aria-hidden="true"><i style={{ width: `${Math.round(((counts.approved + counts.changes) / posts.length) * 100)}%` }} /></div>
                        <ul className="slist">
                            <li><span>Approved</span><b>{counts.approved}</b></li>
                            <li><span>Changes requested</span><b>{counts.changes}</b></li>
                            <li><span>Not reviewed</span><b>{counts.pending}</b></li>
                            <li><span>Questions answered</span><b>{counts.answered} of {questions.length}</b></li>
                        </ul>
                        {counts.pending > 0 && <p className="hint">You can send with posts still not reviewed.</p>}
                        <button className="btn btn-primary full" type="button" onClick={() => setAskName(true)}>Review and send</button>
                    </section>
                </aside>
            </div>
            <div className="mbar">
                <div className="t"><b>{counts.approved + counts.changes} of {posts.length} reviewed</b><span>{counts.pending} still open</span></div>
                <button className="btn btn-primary" type="button" onClick={() => setAskName(true)}>Review and send</button>
            </div>
            {askName && (
                <div className="stack" style={{ position: 'fixed', inset: 0 }}>
                    <div className="scrim" />
                    <form className="modal" onSubmit={event => { event.preventDefault(); send(); }}>
                        <h2>Who should we say reviewed these?</h2>
                        <p className="lead">Your name is required. Email is optional, and we will not send you anything.</p>
                        <div className="field">
                            <label className="label" htmlFor="reviewer-name">Your name</label>
                            <input id="reviewer-name" className={nameError ? 'input err' : 'input'} value={name} aria-invalid={nameError || undefined} onChange={event => { setName(event.target.value); setNameError(false); }} />
                            {nameError && <p className="errmsg" role="alert">Enter your name so we know who reviewed these posts.</p>}
                        </div>
                        <div className="field">
                            <label className="label" htmlFor="reviewer-email">Email <span className="lopt">(optional)</span></label>
                            <input id="reviewer-email" className="input" type="email" value={email} onChange={event => setEmail(event.target.value)} />
                        </div>
                        {error && <p className="errmsg" role="alert">{error}</p>}
                        <button className="btn btn-primary full" type="submit" disabled={busy || uploading}>{busy ? 'Sending…' : 'Send review'}</button>
                    </form>
                </div>
            )}
        </Shell>
    );
}

function Shell({ children, clientName, logoSrc, active = false }: { children: ReactNode; clientName?: string; logoSrc?: string; active?: boolean }) {
    return (
        <div className="gbp-public">
            <header className="band">
                <div className="band-in">
                    <div className="wordmark">Marketing Empire Group<small>Post review</small></div>
                    <span className="lock"><span>Private review link</span></span>
                </div>
            </header>
            {active && clientName && (
                <div className="prep">
                    <div className="prep-in">
                        {logoSrc && <img src={logoSrc} alt={`${clientName} logo`} />}
                        <div><div className="k">Prepared for</div><div className="v">{clientName}</div></div>
                    </div>
                </div>
            )}
            <main>{children}</main>
            {active && <p className="footer">Shared with you by Marketing Empire Group. This link works until it expires. No account needed.</p>}
        </div>
    );
}

function PostCard({
    post, total, choice, open, comment, suggestedTitle, suggestedBody, onSuggest, showFull, onApprove, onRequest, onComment, onToggleFull, clientName, logoSrc, onUpload, uploading, uploaded,
}: {
    post: ReviewPost;
    clientName: string;
    logoSrc?: string;
    onUpload: (file: File) => void;
    uploading: boolean;
    uploaded: boolean;
    total: number;
    choice?: 'approved' | 'changes_requested';
    open: boolean;
    comment: string;
    suggestedTitle: string;
    suggestedBody: string;
    onSuggest: (field: 'title' | 'body', value: string) => void;
    showFull: boolean;
    onApprove: () => void;
    onRequest: () => void;
    onComment: (value: string) => void;
    onToggleFull: () => void;
}) {
    const [suggestOpen, setSuggestOpen] = useState(false);
    const status = choice ?? post.status;
    const parts = post.previousBody ? diffWords(post.previousBody, post.body) : [];
    return (
        <article className={open ? 'ritem sel' : 'ritem'} aria-label={`Post ${post.position}`}>
            <div className="ri-head">
                <div className="k">Post {post.position} of {total} <span>· Planned for {weekday(post.scheduled)}</span></div>
                {status === 'approved' && <span className="chip chip-approved"><Check />Approved</span>}
                {status === 'changes_requested' && <span className="chip chip-changes">Changes requested</span>}
                {status === 'pending' && <span className="chip chip-pending">Not reviewed</span>}
            </div>
            {post.previousBody && (
                <div className="ch-panel">
                    <h3>What changed</h3>
                    {post.changeNote && <p>{post.changeNote}</p>}
                    <div className="diff">
                        {parts.map((part, index) => part.kind === 'same'
                            ? <span key={index}>{part.text}</span>
                            : <span key={index} className={part.kind === 'removed' ? 'del' : 'ins'}><span className="dl">{part.kind === 'removed' ? 'Removed:' : 'Added:'}</span>{part.text}</span>)}
                    </div>
                </div>
            )}
            {post.replacementPhoto && (
                <div className="ch-panel">
                    <h3>Replacement photo</h3>
                    <div className="cmp">
                        <figure><div className="box">No photo</div><figcaption>Before</figcaption></figure>
                        <figure><img src={post.replacementPhoto} alt="Replacement photo for post 5" /><figcaption>Your photo</figcaption></figure>
                    </div>
                </div>
            )}
            <div className="ri-body">
                <div className="ri-grid">
                    <div>
                        <article className="gbp">
                            <div className={post.photo ? 'g-photo' : 'g-photo g-photo-missing'}>
                                {post.photo ? <img src={post.photo} alt="" /> : <div className="miss"><strong>Photo needed</strong><span>We need a photo of a finished remodel for this post.</span></div>}
                            </div>
                            <div className="g-body">
                                <div className="g-head"><span className="g-av">{logoSrc ? <img src={logoSrc} alt="" /> : <span className="g-av-initial" aria-hidden="true">{clientName.charAt(0).toUpperCase()}</span>}</span><span className="g-meta"><span className="g-biz">{clientName}</span><span className="g-age">Planned for {weekday(post.scheduled)}</span></span></div>
                                <div className="g-offer">{post.postType ?? 'Offer'}</div>
                                <h3 className="g-title">{post.title}</h3>
                                <div className="g-date">{monthDay(post.offerStart)} – {monthDay(post.offerEnd)}</div>
                                <p className="g-desc">{showFull ? post.body : `${post.body.slice(0, 140)}…`} <span className="g-more">More</span></p>
                                <div className="g-cta"><span className="g-btn">{post.ctaLabel ?? 'View offer'}</span></div>
                            </div>
                        </article>
                        <button className="btn btn-ghost" type="button" style={{ marginTop: 8, paddingLeft: 0 }} onClick={onToggleFull}>{showFull ? 'Show the short preview' : 'Show full post and terms'}</button>
                        {showFull && <p className="hint">{post.terms}</p>}
                    </div>
                    <dl className="det">
                        <dt>Planned for</dt><dd>{weekday(post.scheduled)}</dd>
                        <dt>Offer runs</dt><dd>{monthDay(post.offerStart)} – {monthDay(post.offerEnd)}</dd>
                        <dt>Button</dt><dd>{post.ctaLabel ?? 'View offer'}</dd>
                        <dt>Opens</dt><dd>{post.ctaUrl}</dd>
                        <dt>Photo</dt><dd>{post.photo ? 'Included' : 'Needed'}</dd>
                    </dl>
                </div>
            </div>
            <div className="actions">
                {post.locked && <p className="hint">The agency has acted on this post. Its decision is locked.</p>}
                <button className={status === 'approved' ? 'btn btn-primary sel-ok' : 'btn btn-primary'} type="button" disabled={post.locked} onClick={onApprove}><Check />{post.previousBody ? 'Approve v2' : 'Approve'}</button>
                <button className={status === 'changes_requested' ? 'btn btn-secondary sel-ch' : 'btn btn-secondary'} type="button" disabled={post.locked} onClick={onRequest}>Request changes</button>
            </div>
            {open && !post.locked && (
                <div className="ch-panel">
                    <h3>What should we change?</h3>
                    <label className="label" htmlFor={`photo-${post.position}`}>Replacement photo (optional)</label>
                    <input id={`photo-${post.position}`} type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); }} />
                    {uploaded && <p className="hint">Photo uploaded. Send your review to share it.</p>}
                    <label className="label" htmlFor={`comment-${post.position}`}>Comment</label>
                    <textarea id={`comment-${post.position}`} className="input ta" value={comment} onChange={event => onComment(event.target.value)} />
                    <button className="disc" type="button" aria-expanded={suggestOpen} aria-controls={`suggest-${post.position}`} onClick={() => setSuggestOpen(current => !current)}>
                        Suggest an edit (optional)
                        <svg className="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                    </button>
                    <div id={`suggest-${post.position}`} hidden={!suggestOpen}>
                        <div className="field">
                            <label className="label" htmlFor={`suggest-title-${post.position}`}>Suggested title</label>
                            <input id={`suggest-title-${post.position}`} className="input" maxLength={80} value={suggestedTitle} onChange={event => onSuggest('title', event.target.value)} />
                        </div>
                        <div className="field">
                            <label className="label" htmlFor={`suggest-body-${post.position}`}>Suggested text</label>
                            <textarea id={`suggest-body-${post.position}`} className="input ta" maxLength={2000} value={suggestedBody} onChange={event => onSuggest('body', event.target.value)} />
                        </div>
                    </div>
                    <p className="hint">A comment is required to request changes. A suggested edit is optional and stays a suggestion until we accept it.</p>
                </div>
            )}
        </article>
    );
}
