'use client';

import { useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { InternalLinkControls } from '@/components/internal-review/InternalLinkControls';
import { ReviewDialog } from './StaffReviewDialogs';
import { type StaffReviewData, type ReviewAction } from './StaffReviewTypes';

export function StaffReviewSections({ data, draft, editable, busy, url, act, sendReason, reportNotice }: {
  data: StaffReviewData;
  draft: boolean;
  editable: boolean;
  busy: boolean;
  url: string;
  act: ReviewAction;
  sendReason: ReactNode;
  reportNotice: (message: string) => void;
}) {
  const [revoke, setRevoke] = useState(false);
  const [copied, setCopied] = useState('');
  const expiry = data.link?.expiresAt ?? new Date(Date.now() + 14 * 86400000).toISOString();
  return <div className="ar-secondary">
    <section className="ar-card ar-section" id="ar-share">
      <h2>{draft ? 'Send to client' : 'Share link'}</h2>
      {draft ? <>
        <p>Send creates a private review link. The app doesn’t email anyone. You share the link.</p>
        <p>Clients give a name to respond. Email is optional.</p>
        <p>Link expires <strong>{new Date(expiry).toLocaleDateString()}</strong> · 14 days</p>
        {sendReason}
      </> : <>
        {url ? <>
          <label className="ar-share-url">Review URL<input readOnly value={url} onFocus={event => event.target.select()} /></label>
          <button className="ar-button" onClick={() => void navigator.clipboard.writeText(url).then(() => {
            setCopied(url);
            reportNotice('Link copied.');
          }).catch(() => reportNotice('Select and copy the URL above.'))}>
            <Copy size={15} aria-hidden />{copied === url ? 'Copied' : 'Copy'}
          </button>
        </> : <p>The URL is shown only when created. Extend keeps the same link. To replace a lost link, revoke it and create another.</p>}
        <dl className="ar-link-facts">
          <div><dt>Status</dt><dd>{data.link?.state ?? 'No link yet'}</dd></div>
          <div><dt>Expires</dt><dd>{data.link ? new Date(expiry).toLocaleString() : '—'}</dd></div>
          <div><dt>Opened</dt><dd>{data.link?.openedAt ? new Date(data.link.openedAt).toLocaleString() : 'Not opened yet'}</dd></div>
        </dl>
        {editable && <div className="ar-actions">
          {data.link && !data.link.revokedAt ? <>
            <button className="ar-button" disabled={busy} onClick={() => void act('link/extend')}>Extend 14 days</button>
            <button className="ar-button" disabled={busy} onClick={() => setRevoke(true)}>Revoke</button>
          </> : <button className="ar-button" disabled={busy || !data.canSend} onClick={() => void act('link/issue')}>Create new link</button>}
        </div>}
        {revoke && <ReviewDialog title="Revoke this link?" description="The client will lose access. Previous feedback is kept." onClose={() => setRevoke(false)}>
          <div className="ar-actions">
            <button className="ar-button" onClick={() => setRevoke(false)}>Cancel</button>
            <button className="ar-button" disabled={busy} onClick={async () => {
              if (await act('link/revoke')) setRevoke(false);
            }}>Confirm revoke</button>
          </div>
        </ReviewDialog>}
      </>}
    </section>
    {data.request.item_type === 'gbp_post' && data.canWrite && <section className="ar-card ar-section">
      <InternalLinkControls key={data.request.id} requestId={data.request.id} canCreate={draft && editable} />
    </section>}
    {!!data.questions.length && <section className="ar-card ar-section">
      <h2>Questions for the client</h2>
      <ul>{data.questions.map(question => <li key={question.id}>{question.prompt}</li>)}</ul>
    </section>}
    <details className="ar-card ar-section">
      <summary>History</summary>
      {(data.staffReviewHistory?.length ?? 0) > 0 && <section>
        <h3>Staff review history</h3>
        <ul>{data.staffReviewHistory?.map(review => {
          const version = data.versions.find(version => version.id === review.version_id);
          return <li key={review.id}>
            <strong>{version?.payload.title ?? 'Item'}{version ? ` · v${version.version_no}` : ''}</strong>
            {' · '}{review.decision === 'approved' ? 'Approved' : 'Changes requested'} by {review.reviewer_name ?? 'Staff'}
            {' · '}{new Date(review.created_at).toLocaleString()}
            {review.note && <p className="whitespace-pre-wrap">{review.note}</p>}
            {!!review.tags.length && <p className="ar-capitalize">{review.tags.join(' · ')}</p>}
          </li>;
        })}</ul>
      </section>}
      {data.versions.map(version => <p key={version.id}>Version {version.version_no}: {version.payload.title} · {new Date(version.created_at).toLocaleString()}{version.change_note ? ` · ${version.change_note}` : ''}</p>)}
      {data.events.map(event => <p key={event.id}>{event.kind.replaceAll('_', ' ')} · {new Date(event.created_at).toLocaleString()}</p>)}
    </details>
  </div>;
}
