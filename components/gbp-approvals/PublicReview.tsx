'use client';

import { useMemo, useState, type ReactNode } from 'react';

import { diffWords } from '@/lib/gbp-approvals/diff';

import './public-review.css';
import { LOGO, SAMPLE_QUESTIONS, SAMPLE_TERMS, monthDay, weekday, type SamplePost } from './sample';

export interface ReviewQuestion {
    id: string;
    prompt: string;
    about: string;
    answer: string | null;
}

type Mode = 'review' | 'revision' | 'expired' | 'revoked' | 'missing';

function Check() {
    return <svg className="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

export function PublicReview({
    mode,
    posts,
    questions = SAMPLE_QUESTIONS,
    clientName = 'ALL-IN-1 Construction',
}: {
    mode: Mode;
    posts: SamplePost[];
    questions?: ReviewQuestion[];
    clientName?: string;
}) {
    const [choices, setChoices] = useState<Record<number, 'approved' | 'changes_requested' | undefined>>({});
    const [openChanges, setOpenChanges] = useState<number | null>(null);
    const [comments, setComments] = useState<Record<number, string>>({});
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [full, setFull] = useState<Record<number, boolean>>({});
    const [askName, setAskName] = useState(false);
    const [name, setName] = useState('');
    const [nameError, setNameError] = useState(false);
    const [sent, setSent] = useState(false);

    const counts = useMemo(() => {
        const approved = posts.filter(post => (choices[post.position] ?? (mode === 'revision' ? post.status : undefined)) === 'approved').length;
        const changes = posts.filter(post => (choices[post.position] ?? (mode === 'revision' ? post.status : undefined)) === 'changes_requested').length;
        const pending = posts.length - approved - changes;
        const answered = questions.filter(question => (answers[question.id] ?? question.answer ?? '').trim()).length;
        return { approved, changes, pending, answered };
    }, [answers, choices, mode, posts, questions]);

    if (mode === 'missing') {
        return <Shell clientName={clientName}><section className="panel"><h1 className="title">This link isn't available</h1><p className="lead">Check the link you were given, or contact your account manager.</p></section></Shell>;
    }
    if (mode === 'expired' || mode === 'revoked') {
        return (
            <Shell clientName={clientName}>
                <section className="panel">
                    <h1 className="title">{mode === 'expired' ? 'This review link has expired' : 'This review link was turned off'}</h1>
                    <p className="lead">
                        {mode === 'expired'
                            ? 'It expired on Fri, Nov 27. Contact your account manager and ask for a new link. Anything you already sent was saved.'
                            : 'Marketing Empire Group turned this link off. Contact your account manager if you still need to review these posts.'}
                    </p>
                </section>
            </Shell>
        );
    }

    if (sent) {
        return (
            <Shell clientName={clientName}>
                <section className="panel">
                    <div className="done-ic" aria-hidden="true"><Check /></div>
                    <h1 className="title">Thanks, {name.trim()}. We have your review.</h1>
                    <p className="lead">Approved posts stay on the dates already scheduled. If we update a post, it shows up on this same link. Nothing else is sent. You can reopen this page until the link expires.</p>
                </section>
            </Shell>
        );
    }

    const updated = mode === 'revision' ? posts.filter(post => post.previousBody || post.replacementPhoto) : [];
    const waiting = mode === 'revision' ? posts.filter(post => post.status === 'pending') : [];
    const kept = mode === 'revision' ? posts.filter(post => post.status === 'approved' && !post.previousBody) : [];

    function approveAll() {
        const next: Record<number, 'approved'> = {};
        for (const post of posts) next[post.position] = 'approved';
        setChoices(next);
    }

    function send() {
        if (!name.trim()) {
            setNameError(true);
            return;
        }
        setSent(true);
        setAskName(false);
    }

    return (
        <Shell clientName={clientName}>
            <div className="wrap">
                <div>
                    {mode === 'revision' && (
                        <div className="notice" role="status">
                            <span><b>Revision ready.</b> {updated.length} posts were updated for you. Nothing new was sent. You are on the same link.</span>
                        </div>
                    )}
                    {mode === 'review' && (
                        <section className="panel">
                            <h1 className="title">Review your Google posts</h1>
                            <p className="lead">Marketing Empire Group drafted {posts.length} Google Business Profile offer posts for {clientName}. Approve each one, or tell us what to change.</p>
                            <div className="facts">
                                <span>{posts.length} posts</span>
                                <span>{questions.length} questions</span>
                                <span>Please review by Sun, Nov 15</span>
                            </div>
                            <ol className="steps">
                                <li>Read each post as it will look on Google</li>
                                <li>Approve it or request changes</li>
                                <li>Answer the questions</li>
                                <li>Add your name and send</li>
                            </ol>
                            <div className="notice"><span><b>Happy with all of them?</b> Approve all {posts.length} at once. You can still change any post before you send. Post 5 still needs a photo.</span></div>
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
                                        <textarea className="input ta" id={question.id} value={answers[question.id] ?? ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} />
                                    </div>
                                </div>
                            ))}
                        </section>
                    )}
                    <div className="sec-h"><h2>{mode === 'revision' ? 'Updated posts' : `Your ${posts.length} posts`}</h2></div>
                    {(mode === 'revision' ? updated : posts).map(post => (
                        <PostCard
                            key={post.position}
                            post={post}
                            total={posts.length}
                            choice={choices[post.position]}
                            open={openChanges === post.position}
                            comment={comments[post.position] ?? ''}
                            showFull={full[post.position] === true}
                            onApprove={() => setChoices(current => ({ ...current, [post.position]: 'approved' }))}
                            onRequest={() => { setOpenChanges(post.position); setChoices(current => ({ ...current, [post.position]: 'changes_requested' })); }}
                            onComment={value => setComments(current => ({ ...current, [post.position]: value }))}
                            onToggleFull={() => setFull(current => ({ ...current, [post.position]: !current[post.position] }))}
                        />
                    ))}
                    {mode === 'revision' && waiting.map(post => (
                        <article className="ritem" key={post.position}><div className="collapsed"><div className="t">Post {post.position} <span>{post.title}</span></div><span className="chip chip-pending">Not reviewed</span></div></article>
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
                            <input id="reviewer-email" className="input" type="email" />
                        </div>
                        <button className="btn btn-primary full" type="submit">Send review</button>
                    </form>
                </div>
            )}
        </Shell>
    );
}

function Shell({ children, clientName }: { children: ReactNode; clientName: string }) {
    return (
        <div className="gbp-public">
            <header className="band">
                <div className="band-in">
                    <div className="wordmark">Marketing Empire Group<small>Post review</small></div>
                    <span className="lock"><span>Private review link</span></span>
                </div>
            </header>
            <div className="prep">
                <div className="prep-in">
                    <img src={LOGO} alt={`${clientName} logo`} />
                    <div><div className="k">Prepared for</div><div className="v">{clientName}</div></div>
                </div>
            </div>
            <main>{children}</main>
            <p className="footer">Shared with you by Marketing Empire Group. This link works until it expires. No account needed.</p>
        </div>
    );
}

function PostCard({
    post, total, choice, open, comment, showFull, onApprove, onRequest, onComment, onToggleFull,
}: {
    post: SamplePost;
    total: number;
    choice?: 'approved' | 'changes_requested';
    open: boolean;
    comment: string;
    showFull: boolean;
    onApprove: () => void;
    onRequest: () => void;
    onComment: (value: string) => void;
    onToggleFull: () => void;
}) {
    const status = choice ?? post.status;
    const parts = post.previousBody && post.suggestedBody ? diffWords(post.previousBody, post.suggestedBody) : [];
    return (
        <article className={open ? 'ritem sel' : 'ritem'} aria-label={`Post ${post.position}`}>
            <div className="ri-head">
                <div className="k">Post {post.position} of {total} <span>· Goes live {weekday(post.scheduled)}</span></div>
                {status === 'approved' && <span className="chip chip-approved"><Check />Approved</span>}
                {status === 'changes_requested' && <span className="chip chip-changes">Changes requested</span>}
                {status === 'pending' && <span className="chip chip-pending">Not reviewed</span>}
            </div>
            {post.previousBody && (
                <div className="ch-panel">
                    <h3>What changed</h3>
                    <p>Removed the leftovers line, as you suggested.</p>
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
                                <div className="g-head"><span className="g-av"><img src={LOGO} alt="" /></span><span className="g-meta"><span className="g-biz">ALL-IN-1 Construction</span><span className="g-age">Scheduled {weekday(post.scheduled)}</span></span></div>
                                <div className="g-offer">Offer</div>
                                <h3 className="g-title">{post.title}</h3>
                                <div className="g-date">{monthDay(post.offerStart)} – {monthDay(post.offerEnd)}</div>
                                <p className="g-desc">{showFull ? post.body : `${post.body.slice(0, 140)}…`} <span className="g-more">More</span></p>
                                <div className="g-cta"><span className="g-btn">View offer</span></div>
                            </div>
                        </article>
                        <button className="btn btn-ghost" type="button" style={{ marginTop: 8, paddingLeft: 0 }} onClick={onToggleFull}>{showFull ? 'Show the short preview' : 'Show full post and terms'}</button>
                        {showFull && <p className="hint">{SAMPLE_TERMS}</p>}
                    </div>
                    <dl className="det">
                        <dt>Goes live</dt><dd>{weekday(post.scheduled)}</dd>
                        <dt>Offer runs</dt><dd>{monthDay(post.offerStart)} – {monthDay(post.offerEnd)}</dd>
                        <dt>Button</dt><dd>View offer</dd>
                        <dt>Opens</dt><dd>allinone-const.com/contact/</dd>
                        <dt>Photo</dt><dd>{post.photo ? 'Included' : 'Needed'}</dd>
                    </dl>
                </div>
            </div>
            <div className="actions">
                <button className={status === 'approved' ? 'btn btn-primary sel-ok' : 'btn btn-primary'} type="button" onClick={onApprove}><Check />{post.previousBody ? 'Approve v2' : 'Approve'}</button>
                <button className={status === 'changes_requested' ? 'btn btn-secondary sel-ch' : 'btn btn-secondary'} type="button" onClick={onRequest}>Request changes</button>
            </div>
            {open && (
                <div className="ch-panel">
                    <h3>What should we change?</h3>
                    <label className="label" htmlFor={`comment-${post.position}`}>Comment</label>
                    <textarea id={`comment-${post.position}`} className="input ta" value={comment} onChange={event => onComment(event.target.value)} />
                    <p className="hint">A comment is required to request changes. A suggested edit is optional and stays a suggestion until we accept it.</p>
                </div>
            )}
        </article>
    );
}
