'use client';

import { useState } from 'react';

import { diffWords } from '@/lib/gbp-approvals/diff';

import './agency-review.css';
import { LOGO, SAMPLE_POSTS, SAMPLE_QUESTIONS, monthDay, weekday, type SamplePost } from './sample';

export function AgencyStatus({ embedded = false }: { embedded?: boolean }) {
    const [selected, setSelected] = useState(2);
    const [accepted, setAccepted] = useState(false);
    const [note, setNote] = useState('Removed the leftovers line, as you suggested.');
    const [toast, setToast] = useState<string | null>(null);
    const post = SAMPLE_POSTS.find(item => item.position === selected) ?? SAMPLE_POSTS[1];
    const before = post.previousBody ?? '';
    const after = accepted ? (post.suggestedBody ?? post.body) : before;
    const parts = before && post.suggestedBody ? diffWords(before, post.suggestedBody) : [];

    return (
        <div className={embedded ? 'gbp-agency embedded' : 'gbp-agency'}>
            <div className="page">
                <div className="crumbs"><span>Tasks</span><span>/</span><span>ALL-IN-1 Construction</span><span>/</span><span>GBP holiday posts</span></div>
                <div className="task-head">
                    <div>
                        <h1>GBP holiday posts: free walkthrough offer (7 posts)</h1>
                        <div className="meta"><span>ALL-IN-1 Construction</span><span>Due Sun, Nov 15</span><span className="chip chip-changes">Changes requested</span></div>
                    </div>
                    <button className="btn btn-secondary" type="button">Open as client</button>
                </div>
                <div className="tabs"><a className="on" href="#items">Items</a><a href="#share">Share link</a><a href="#history">History</a></div>
                <div className="tiles">
                    <div className="tile"><b>4</b><span>Approved</span></div>
                    <div className="tile"><b>2</b><span>Changes requested</span></div>
                    <div className="tile"><b>1</b><span>Pending</span></div>
                    <div className="tile"><b>1 / 3</b><span>Questions answered</span></div>
                </div>
                <p className="notice">Link active · expires Fri, Nov 27 · 3 views · last opened Sat Nov 14, 9:12 AM PT. Extend keeps this same link.</p>
                <div className="grid" style={{ marginTop: 16 }}>
                    <section className="card items">
                        {SAMPLE_POSTS.map(item => (
                            <button className={item.position === selected ? 'item' : 'item'} key={item.position} type="button" onClick={() => setSelected(item.position)} style={item.position === selected ? { borderColor: '#3DD0E0' } : undefined}>
                                <span className="thumb">{item.photo ? <img src={item.photo} alt="" /> : <span className="chip chip-photo">Photo needed</span>}</span>
                                <span className="dmeta">
                                    <b>Post {item.position} · {weekday(item.scheduled)}</b>
                                    <span className="k">{item.title}</span>
                                </span>
                                {item.status === 'approved' && <span className="chip chip-approved">Approved</span>}
                                {item.status === 'changes_requested' && <span className="chip chip-changes">Changes requested</span>}
                                {item.status === 'pending' && <span className="chip chip-pending">Pending</span>}
                            </button>
                        ))}
                    </section>
                    <div>
                        <Detail post={post} parts={parts} after={after} accepted={accepted} note={note} onNote={setNote} onAccept={() => { setAccepted(true); setToast('Suggestion accepted into v2. Nothing was sent.'); }} />
                        {post.position === 5 && post.replacementPhoto && (
                            <section className="card" style={{ marginTop: 16 }}>
                                <div className="card-head"><h2>Replacement photo from client</h2><span className="chip chip-changes">Changes requested</span></div>
                                <div className="photo-cmp">
                                    <figure><div className="box" style={{ minHeight: 120, display: 'grid', placeItems: 'center' }}>Photo needed</div><figcaption>v1 · no photo</figcaption></figure>
                                    <figure><img src={post.replacementPhoto} alt="Sample stand-in uploaded by the client" /><figcaption>Uploaded Sat Nov 14 · sample stand-in</figcaption></figure>
                                </div>
                                <button className="btn btn-primary" type="button" onClick={() => setToast('Photo accepted into v2. The scheduled date did not change.')}>Use in v2</button>
                            </section>
                        )}
                    </div>
                </div>
                <div className="grid" style={{ marginTop: 16 }}>
                    <section className="card">
                        <h2>Questions</h2>
                        <p className="sub">1 of 3 answered</p>
                        {SAMPLE_QUESTIONS.map(question => (
                            <div className="qa" key={question.id}>
                                <p>{question.prompt}</p>
                                <p className="sub">{question.answer ?? 'Not answered'}</p>
                            </div>
                        ))}
                    </section>
                    <section className="card" id="history">
                        <h2>Revision history</h2>
                        <ul className="tl">
                            <li><b>v1 sent</b><span className="s">7 posts, 3 questions · Fri Nov 13, 7:05 PM PT</span></li>
                            <li><b>Client feedback</b><span className="s">4 approved, 2 changes, 1 not reviewed · Sat Nov 14, 9:41 AM PT</span></li>
                            <li><b>v2</b><span className="s">{accepted ? 'Post 2 suggestion accepted. Send the revision when the note is ready.' : 'Not posted yet. Accept the suggestion or edit by hand.'}</span></li>
                        </ul>
                        <p className="hint">Approval does not change the scheduled date. When every post is approved, the task moves to In Progress.</p>
                    </section>
                </div>
                {toast && <p className="toast" role="status" style={{ position: 'fixed', bottom: 24, right: 24 }}>{toast}</p>}
            </div>
        </div>
    );
}

function Detail({
    post, parts, after, accepted, note, onNote, onAccept,
}: {
    post: SamplePost;
    parts: { kind: 'same' | 'removed' | 'added'; text: string }[];
    after: string;
    accepted: boolean;
    note: string;
    onNote: (value: string) => void;
    onAccept: () => void;
}) {
    return (
        <section className="card">
            <div className="card-head">
                <h2>Post {post.position} · {weekday(post.scheduled)}</h2>
                {post.status === 'changes_requested' && <span className="chip chip-changes">Changes requested</span>}
            </div>
            <article className="gbp">
                <div className={post.photo ? 'g-photo' : 'g-photo g-photo-missing'}>
                    {post.photo ? <img src={post.photo} alt="" /> : <div style={{ padding: 24 }}><b>Photo needed</b></div>}
                </div>
                <div className="g-body">
                    <div className="g-head"><span className="g-av"><img src={LOGO} alt="" /></span><span className="g-meta"><span className="g-biz">ALL-IN-1 Construction</span></span></div>
                    <h3 className="g-title">{post.title}</h3>
                    <div className="g-date">{monthDay(post.offerStart)} – {monthDay(post.offerEnd)}</div>
                    <p className="g-desc">{after || post.body}</p>
                </div>
            </article>
            {post.comment && (
                <div className="thread" style={{ marginTop: 16 }}>
                    <div className="msg">
                        <span className="avatar">CR</span>
                        <div className="bubble">
                            <div className="who">Client reviewer <span className="chip chip-sample">Sample</span></div>
                            <p>{post.comment}</p>
                        </div>
                    </div>
                </div>
            )}
            {parts.length > 0 && (
                <>
                    <h3 style={{ marginTop: 16 }}>Suggested edit</h3>
                    <div className="diff">
                        {parts.map((part, index) => part.kind === 'same'
                            ? <span key={index}>{part.text}</span>
                            : <span key={index} className={part.kind === 'removed' ? 'del' : 'ins'}><span className="dl">{part.kind === 'removed' ? 'Removed' : 'Added'}</span>{part.text}</span>)}
                    </div>
                    <div className="legend"><span>Removed</span><span>Added</span></div>
                    <div className="row" style={{ marginTop: 12 }}>
                        <button className="btn btn-primary" type="button" onClick={onAccept} disabled={accepted}>{accepted ? 'Accepted into v2' : 'Accept into v2'}</button>
                        <button className="btn btn-secondary" type="button">Dismiss suggestion</button>
                    </div>
                    <label className="label" htmlFor="change-note" style={{ display: 'block', marginTop: 16 }}>Change note the client will see</label>
                    <textarea id="change-note" className="input" style={{ minHeight: 88 }} value={note} onChange={event => onNote(event.target.value)} />
                    <p className="hint">Sending the revision updates this same link. Nothing is emailed or posted to Basecamp.</p>
                </>
            )}
        </section>
    );
}
