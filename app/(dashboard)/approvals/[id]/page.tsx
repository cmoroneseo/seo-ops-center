'use client';

import '@/components/approvals-v2/page-review.css';
import '@/components/approvals-v2/staff-review.css';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { StaffReviewView } from '@/components/approvals-v2/StaffReviewView';
import { StaffReviewSections } from '@/components/approvals-v2/StaffReviewSections';
import type { SaveStaffReview, StaffReviewData } from '@/components/approvals-v2/StaffReviewTypes';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RequestReview key={id} id={id} />;
}

function RequestReview({ id }: { id: string }) {
  const [data, setData] = useState<StaffReviewData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const writeInFlight = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/approval-requests/${id}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Approvals could not be loaded.');
    setData(body);
  }, [id]);

  useEffect(() => {
    void load().catch(cause => setError(cause instanceof Error ? cause.message : 'Approvals could not be loaded.'));
  }, [load]);

  async function act(path: string, body: unknown = {}, method = 'POST') {
    if (writeInFlight.current) return false;
    writeInFlight.current = true;
    setAction(path);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/approval-requests/${id}${path ? '/' + path : ''}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        if (path === 'send') throw new Error('Couldn’t create the link. Try again.');
        if (path === 'versions' && result.code === 'conflict') throw new Error('This post changed. Refresh before saving a new version.');
        throw new Error(result.code === 'forbidden' ? 'You do not have permission to make this change.' : result.error);
      }
      if (result.url) setUrl(result.url);
      if (path === 'link/revoke') setUrl('');
      setNotice(path === 'send' || path === 'link/issue' ? 'Link created. Nothing was sent to the client.'
        : path === 'link/extend' ? 'Extended 14 days on the same link.' : 'Saved. Nothing was sent to the client.');
      await load();
      window.dispatchEvent(new Event('approvals:changed'));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      return false;
    } finally {
      setAction(null);
      writeInFlight.current = false;
    }
  }

  const saveReview: SaveStaffReview = async input => {
    if (writeInFlight.current) throw new Error('Another change is being saved. Try again.');
    writeInFlight.current = true;
    try {
      const response = await fetch(`/api/approval-requests/${id}/reviews`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) throw new Error('The draft or item version changed. Refresh the request and review it again.');
        if (result.code === 'blocked') throw new Error(result.error);
        throw new Error('Couldn’t save. Try again.');
      }
      setData(previous => {
        if (!previous) return previous;
        const history = previous.staffReviewHistory ?? [];
        return {
          ...previous,
          staffReviewHistory: history.some(row => row.id === result.reviewId) ? history
            : [{ ...result.review, id: result.reviewId, item_id: input.itemId }, ...history],
          items: previous.items.map(item => item.id === input.itemId && item.current_version_id === input.versionId
            ? { ...item, staffReview: result.review } : item),
        };
      });
    } finally {
      writeInFlight.current = false;
    }
  };

  if (!data) return <div className="ar-view">
    <div className="ar-container ar-loading" aria-busy={!error}>
      {error ? <p role="alert" className="ar-error">{error}</p> : <>
        <p className="sr-only" role="status">Loading approval request…</p>
        <div className="ar-skeleton-header" aria-hidden />
        <div className="ar-grid" aria-hidden><div className="ar-skeleton-card" /><div className="ar-skeleton-card" /></div>
      </>}
    </div>
  </div>;

  const draft = data.request.stage === 'draft';
  return <StaffReviewView data={data} act={act} saveReview={saveReview} refresh={load}
    busy={action !== null} sending={action === 'send'} error={error} notice={notice}>
    <StaffReviewSections data={data} draft={draft} editable={data.canWrite && !data.request.archived_at}
      busy={action !== null} url={url} act={act} reportNotice={setNotice}
      sendReason={!data.canSend && <p id="ar-send-permission">{data.sendReason}</p>} />
  </StaffReviewView>;
}
