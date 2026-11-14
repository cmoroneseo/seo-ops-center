'use client';

import './page-review.css';

import { useEffect, useRef, useState } from 'react';
import { PagePreview } from './PagePreview';
import { TypeChip } from './Shared';
import type { PublicPageItem, PublicPageView } from '@/lib/approvals-v2/public';
import type { PagePayload } from '@/lib/approvals-v2/registry';
import type { OutlineSection } from '@/lib/approvals-v2/page-body';
interface LoadedPage {
  version: {
    id: string;
    versionNo: number;
    payload: PagePayload;
    outline: OutlineSection[];
  };
  photoUrl: string | null;
  images: Record<string, string | null>;
}
interface Decision {
  decision: 'approved' | 'changes_requested';
  comment: string;
}
const button = 'min-h-12 rounded-xl border-2 border-[#0E6670] px-5 py-3 font-semibold text-[#0E6670]';
export function PublicPageReview({
  token,
  view
}: {
  token: string;
  view: PublicPageView;
}) {
  const [selected, setSelected] = useState<string | null>(view.items.length === 1 ? view.items[0].id : null);
  const [loaded, setLoaded] = useState<LoadedPage | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'review' | 'send' | 'done'>('review');
  const [sentBy, setSentBy] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const retry = useRef<{
    hash: string;
    key: string;
  } | null>(null);
  const item = view.items.find(item => item.id === selected);
  useEffect(() => {
    if (!selected || view.state !== 'active') return;
    let cancelled = false;
    setLoaded(null);
    setError('');
    void fetch(`/api/public/approvals/${token}/items/${selected}`, {
      cache: 'no-store'
    }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Page could not be loaded.');
      if (!cancelled) setLoaded(body);
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Page could not be loaded.');
    });
    return () => {
      cancelled = true;
    };
  }, [selected, token, view.state]);
  function choose(item: PublicPageItem, decision: Decision['decision']) {
    if (!loaded || loaded.version.id !== item.version.id || item.locked) return;
    setDecisions(previous => ({
      ...previous,
      [item.id]: {
        decision,
        comment: previous[item.id]?.comment ?? ''
      }
    }));
  }
  const ready = view.items.every(item => item.locked || decisions[item.id] && (decisions[item.id].decision === 'approved' || decisions[item.id].comment.trim()));
  const summary = view.items.map(item => ({
    title: item.version.payload.title,
    choice: decisions[item.id]?.decision ?? item.status,
    version: item.version.versionNo
  }));
  async function send(form: HTMLFormElement) {
    if (!ready) return;
    setBusy(true);
    setError('');
    const fields = new FormData(form);
    const body = {
      itemType: 'page',
      respondentName: String(fields.get('name') ?? '').trim(),
      respondentEmail: String(fields.get('email') ?? '').trim() || null,
      displayedVersionIds: view.items.map(item => item.version.id),
      decisions: view.items.filter(item => !item.locked && decisions[item.id]).map(item => ({
        itemId: item.id,
        versionId: item.version.id,
        ...decisions[item.id]
      })),
      answers: Object.entries(answers).filter(([, answer]) => answer.trim()).map(([questionId, answer]) => ({
        questionId,
        answer
      }))
    };
    const hash = JSON.stringify(body);
    if (retry.current?.hash !== hash) retry.current = {
      hash,
      key: crypto.randomUUID()
    };
    try {
      const response = await fetch(`/api/public/approvals/${token}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...body,
          idempotencyKey: retry.current.key
        })
      });
      const result = await response.json();
      if (!response.ok) {
        const messages: Record<string, string> = {
          refresh_required: 'This page was updated. Refresh and review the latest version before sending.',
          name_required: 'Enter your name so we know who reviewed these pages.',
          comment_required: 'Tell us what needs to change before sending.',
          decision_locked: 'The agency has started work on this page. Refresh to see the latest review.',
        };
        throw new Error(messages[result.code] ?? result.error ?? 'Your review could not be sent.');
      }
      setSentBy(body.respondentName);
      setStep('done');
      window.scrollTo(0, 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your review could not be sent.');
    } finally {
      setBusy(false);
    }
  }
  return <main className="public-page-review">
    <header className="bg-[#16252B] px-5 py-4 text-white">
      <div className="mx-auto max-w-6xl">
        <strong>MARKETING EMPIRE GROUP</strong>
        <p className="text-sm text-[#C4D0D4]">Page review · Private review link</p>
      </div>
    </header>
    <div className="border-b bg-white px-5 py-4">
      <div className="mx-auto max-w-6xl">Prepared for <strong>
        {view.clientName}
      </strong></div>
    </div>
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
      {view.state !== 'active' ? <section className="rounded-2xl border bg-white p-6">
        <h1 className="text-2xl font-bold">This review link is no longer available</h1>
        <p>Please ask Marketing Empire Group for a new link.</p>
      </section> : step === 'done' ? <section className="mx-auto max-w-2xl rounded-2xl border bg-white p-7">
        <p className="text-4xl text-[#1B6B34]" aria-hidden="true">✓</p>
        <h1 className="my-4 text-3xl font-bold">Thanks! Your account manager will follow up on any changes.</h1>
        <p>We received your review.</p>
        <ul className="my-5 divide-y rounded-xl border">
          {summary.map((row, index) => <li key={index} className="p-4">{row.title} · Version {row.version}<br />{row.choice === 'approved' ? 'Approved' : 'Changes requested'}</li>)}
        </ul>
        <p className="my-3">Sent by {sentBy}</p>
        <h2 className="font-bold">What happens next</h2>
        <p>We’ll review your feedback and follow up if anything needs another look. Approval is sign-off only; it doesn’t set the publish date.</p>
        <p className="mt-4">You can close this window.</p>
      </section> : step === 'send' ? <section className="mx-auto max-w-2xl rounded-2xl border bg-white p-6">
        <h1 className="text-3xl font-bold">Send your review</h1>
        <p className="mt-3">Check your decision and notes, then add your name. This review applies to the versions listed below only.</p>
        <ul className="my-5 divide-y rounded-xl border">
          {summary.map((row, index) => <li key={index} className="p-4">{row.title} · Version {row.version}<br />{row.choice === 'approved' ? 'Approved' : 'Changes requested'}{decisions[view.items[index].id]?.comment && <p className="mt-2 whitespace-pre-wrap">
            {decisions[view.items[index].id].comment}
          </p>}</li>)}
        </ul>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          void send(event.currentTarget);
        }}>
          <label className="block font-semibold">Your name (required)<input name="name" required maxLength={120} autoComplete="name" className="mt-2 block w-full rounded-lg border border-[#7A8087] p-3" /></label>
          <p className="text-sm text-[#545A61]">Shown to Marketing Empire Group with your review.</p>
        <label className="block font-semibold">Email (optional)<input type="email" name="email" maxLength={254} autoComplete="email" className="mt-2 block w-full rounded-lg border border-[#7A8087] p-3" /></label>
          <p className="text-sm text-[#545A61]">Only used if your account manager needs to reach you about this review. We won’t add you to any list.</p>
        {error && <p role="alert" className="text-[#B3261E]">
            {error}
          </p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={button} disabled={busy} onClick={() => setStep('review')}>Back to review</button>
            <button className={`${button} bg-[#0E6670] !text-white`} disabled={busy}>
              {busy ? 'Sending…' : 'Send my review'}
            </button>
          </div>
        </form>
      </section> : <>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Review your {view.items.length === 1 ? 'page' : 'pages'}</h1>
          <TypeChip row={{
            itemType: 'page',
            pageKinds: [...new Set(view.items.map(item => item.version.payload.pageKind))]
          }} />
        </div>
        {view.items.length >= 2 && <section className="mb-6 rounded-2xl border bg-white p-5" aria-label="Pages overview">
          <h2 className="text-xl font-bold">Pages to review</h2>
          <p>{Object.keys(decisions).length} of {view.items.length} pages reviewed</p>
          <ul className="divide-y">
            {view.items.map(page => <li key={page.id} className="py-4">
              <button className="w-full text-left" onClick={() => setSelected(page.id)}>
                <TypeChip row={{
                  itemType: 'page',
                  pageKinds: [page.version.payload.pageKind]
                }} />
                <strong>
                  {page.version.payload.title}
                </strong>
                <span className="block break-all text-[#545A61]">/{page.version.payload.slug} · {(decisions[page.id]?.decision ?? page.status).replaceAll('_', ' ')}</span>
              </button>
            </li>)}
          </ul>
        </section>}
        {item && <>
          <div className="mb-5 rounded-lg border border-[#0E6670] bg-[#E6F2F3] p-4">You’re reviewing version {item.version.versionNo}{view.sentAt ? `, sent ${new Date(view.sentAt).toLocaleDateString()}` : ''}. Your decision covers this version exactly as you see it.</div>
          {error && <p role="alert" className="mb-4 text-[#B3261E]">
            {error}
          </p>}
          {!loaded ? <p role="status">Loading page…</p> : loaded.version.id !== item.version.id ? <p role="alert">This page was updated. Refresh before reviewing it.</p> : <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <PagePreview domain={view.domain} payload={loaded.version.payload} photoUrl={loaded.photoUrl} images={loaded.images} />
            <aside className="space-y-5 lg:sticky lg:top-5">
              <nav className="rounded-xl border bg-white p-5" aria-label="Page sections">
                <h2 className="mb-3 font-bold">On this page</h2>
                <select aria-label="Jump to section" className="w-full rounded border p-2 lg:hidden" defaultValue="" onChange={event => document.getElementById(event.target.value)?.scrollIntoView({
                  behavior: 'smooth'
                })}>
                  <option value="" disabled>Jump to section</option>
                  {loaded.version.outline.map(section => <option key={section.sectionId} value={section.slug}>
                    {section.title}
                  </option>)}
                </select>
                <ul className="hidden space-y-2 lg:block">
                  {loaded.version.outline.map(section => <li key={section.sectionId}>
                    <a className="block py-2 text-[#0E6670] underline" href={`#${section.slug}`}>
                      {section.title}
                    </a>
                  </li>)}
                </ul>
              </nav>
              <section className="space-y-3 rounded-xl border bg-white p-5">
                <h2 className="text-xl font-bold">Your decision on this page</h2>
                <p>Applies to version {item.version.versionNo} only. Sign-off doesn’t set the publish date.</p>
                {item.locked ? <p>This decision is locked because the agency already acted on it.</p> : <>
                  <button className={`${button} w-full ${decisions[item.id]?.decision === 'approved' ? 'bg-[#1B6B34] !text-white' : ''}`} aria-pressed={decisions[item.id]?.decision === 'approved'} onClick={() => choose(item, 'approved')}>Approve page</button>
                  <button className={`${button} w-full ${decisions[item.id]?.decision === 'changes_requested' ? 'bg-[#FFF3E0]' : ''}`} aria-pressed={decisions[item.id]?.decision === 'changes_requested'} onClick={() => choose(item, 'changes_requested')}>Request changes</button>
                  {decisions[item.id]?.decision === 'changes_requested' && <label className="block font-semibold">What needs to change? (required)<textarea required maxLength={4000} value={decisions[item.id].comment} onChange={event => setDecisions(previous => ({
                    ...previous,
                    [item.id]: {
                      ...previous[item.id],
                      comment: event.target.value
                    }
                  }))} className="mt-2 min-h-28 w-full rounded-lg border border-[#7A8087] p-3" /></label>}
                  <p className="text-sm text-[#545A61]">Your choice won’t be sent until you press Send review.</p>
                </>}
              </section>
            </aside>
          </div>}
        </>}
        {view.questions.length > 0 && <section className="mt-6 space-y-4 rounded-xl border bg-white p-5">
          <h2 className="text-xl font-bold">Questions for you</h2>
          {view.questions.map(question => <label className="block" key={question.id}>
            {question.prompt}
            <textarea maxLength={4000} value={answers[question.id] ?? question.answer ?? ''} onChange={event => setAnswers(previous => ({
              ...previous,
              [question.id]: event.target.value
            }))} className="mt-2 block w-full rounded-lg border p-3" />
          </label>)}
        </section>}
        <div className="mt-6 rounded-xl border bg-white p-5">
          <p className="mb-3">
            {ready ? 'Your review is ready to send.' : 'Choose Approve or Request changes for each page before sending.'}
          </p>
          <button className={`${button} bg-[#0E6670] !text-white`} disabled={!ready || !Object.keys(decisions).length} onClick={() => {
            setStep('send');
            window.scrollTo(0, 0);
          }}>Review and send</button>
        </div>
      </>}
      <footer className="mt-8 text-sm text-[#545A61]">Shared with you by Marketing Empire Group. {view.expiresAt && `This link works until ${new Date(view.expiresAt).toLocaleDateString()}.`} No account needed.</footer>
    </div>
  </main>;
}
