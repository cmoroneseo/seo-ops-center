'use client';
import { useState } from 'react';
export interface AgencyComment {
  state?: string;
  carryBlockId?: string;
  versionNo?: number;
  addressedVersion?: number;
  id: string;
  item_id: string;
  block_id: string | null;
  pin_target: string | null;
  parent_id: string | null;
  anchor_kind: string;
  author_name: string;
  body: string;
  quote: string | null;
  suggested_text: string | null;
  suggested_image_key: string | null;
  suggestion_status: string | null;
  suggestion_reply: string | null;
  resolved_at: string | null;
  resolved_in_version_id: string | null;
  previewUrl: string | null;
}
export function AgencyComments({ requestId, comments, currentImages, canWrite, refresh, anchorOrder = [] }: {
  requestId: string;
  comments: AgencyComment[];
  currentImages: Record<string, string | null>;
  canWrite: boolean;
  refresh: () => void;
  anchorOrder?: string[];
}) {
  const [reply, setReply] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(comment: AgencyComment, action: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/approval-requests/${requestId}/comments/${comment.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reply: reply[comment.id] }) });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error);
      if (action === 'download') {
        const link = document.createElement('a');
        link.href = result.url;
        link.download = '';
        link.click();
      }
      else {
        if (action === 'accept')
          setNotice(comment.suggested_image_key ? 'Added to the next draft. Check alt text for the new image. The sent version is unchanged.' : 'Added to the next draft. The sent version is unchanged.');
        setReply(previous => ({ ...previous, [comment.id]: '' }));
        refresh();
      }
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Comment could not be updated.');
    }
    finally {
      setBusy(false);
    }
  }
  const anchors = [...new Set(comments.filter(comment => !comment.parent_id).map(comment => comment.carryBlockId ?? comment.block_id ?? comment.pin_target ?? 'page'))];
  anchors.sort((a, b) => {
    const order = (value: string) => value === 'mockup' ? -1 : anchorOrder.includes(value) ? anchorOrder.indexOf(value) : Number.MAX_SAFE_INTEGER;
    return order(a) - order(b);
  });
  return <section className="space-y-4 rounded-xl border p-4">
    <h2 className="text-lg font-bold">Client comments ({comments.filter(comment => !comment.parent_id).length})</h2>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status" className="rounded border bg-sky-50 p-3 text-sky-950">{notice}</p>}
    {anchors.map(anchor => <section key={anchor} className="space-y-3">
      <h3 className="font-semibold">{anchor === 'mockup' ? 'Mockup image' : anchor === 'page' ? 'Page notes' : 'Page content'}</h3>
      {comments.filter(comment => !comment.parent_id && (comment.carryBlockId ?? comment.block_id ?? comment.pin_target ?? 'page') === anchor).map(comment => <article key={comment.id} className="space-y-3 rounded border p-4">
        <p><strong>{comment.author_name}</strong> · {comment.suggested_image_key ? 'Image suggestion' : comment.anchor_kind === 'highlight' ? 'Highlight' : 'Pin'}</p>
        {comment.state === 'moved' && <p>Moved</p>}
        {comment.state === 'earlier' && <p>Earlier comments</p>}
        {comment.state === 'text_changed' && <p>Text changed since v{comment.versionNo}</p>}
        {comment.quote && <blockquote className="border-l-4 border-[#8A5A00] bg-[#FCEFC7] p-3">“{comment.quote}”</blockquote>}
        <p className="whitespace-pre-wrap">{comment.body}</p>
        {comment.suggested_text && <p>Suggested wording: {comment.suggested_text}</p>}
        {comment.previewUrl && <div className="grid grid-cols-2 gap-3"><figure><figcaption>Current</figcaption>{currentImages[anchor] && <img src={currentImages[anchor]!} alt="Current image" />}</figure><figure><figcaption>Suggested</figcaption><img src={comment.previewUrl} alt="Client image suggestion" /></figure></div>}
        {comment.resolved_at && <p>Addressed{comment.resolved_in_version_id ? ` in version ${comment.addressedVersion ?? ''}` : ''}</p>}
        {comment.suggestion_status === 'declined' && <p>Declined</p>}
        {comment.suggestion_status === 'superseded' && <p>Superseded by a newer suggestion</p>}
        {comment.suggestion_reply && <p>Answered: {comment.suggestion_reply}</p>}
        {comments.filter(reply => reply.parent_id === comment.id).map(reply => <p key={reply.id}><strong>{reply.author_name}:</strong> {reply.body}</p>)}
        {canWrite && <>
          <label className="block">Reply (optional for Decline)<textarea maxLength={2000} className="mt-1 block w-full rounded border p-3" value={reply[comment.id] ?? ''} onChange={event => setReply(previous => ({ ...previous, [comment.id]: event.target.value }))} /></label>
          <div className="flex flex-wrap gap-2">
            {['reply', comment.resolved_at || comment.suggestion_status === 'declined' ? 'reopen' : 'resolve', ...((comment.suggested_text || comment.suggested_image_key) && comment.suggestion_status === 'pending' ? ['accept', 'decline'] : []), ...(comment.suggested_image_key ? ['download'] : [])].map(action => <button key={action} className="min-h-11 rounded border px-4" disabled={busy || action === 'reply' && !reply[comment.id]?.trim()} onClick={() => void act(comment, action)}>{({ reply: 'Reply', resolve: 'Resolve', reopen: 'Reopen', accept: 'Accept suggestion', decline: 'Decline', download: 'Download original' } as Record<string, string>)[action]}</button>)}
          </div>
          {(comment.suggested_text || comment.suggested_image_key) && <p className="text-sm">Accept adds to the next draft only.</p>}
        </>}
      </article>)}
    </section>)}
  </section>;
}
