'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PagePreview } from './PagePreview';
import { ReplaceImage } from './ReplaceImage';
import { blockText, type CommentAnchor, type DraftComment } from '@/lib/approvals-v2/carry';
import { sanitizeDoc, type PageNode } from '@/lib/approvals-v2/page-doc';
import { selectionAnchor } from '@/lib/approvals-v2/selection';
import type { PagePayload } from '@/lib/approvals-v2/registry';
import type { OutlineSection } from '@/lib/approvals-v2/page-body';
export interface ReviewComment {
  id: string;
  anchor: CommentAnchor;
  body: string;
  quote?: string;
  state: string;
  versionNo: number;
  reply?: string | null;
  addressed?: boolean;
  addressedVersion?: number | null;
  suggestedImageUrl?: string | null;
}
const control = 'min-h-12 rounded-lg border px-3 py-2';
export function PageComments({ token, itemId, versionId, versionNo, payload, outline, photoUrl, photoHash, images, domain, drafts, onChange, comments = [], locked, children }: {
  token: string;
  itemId: string;
  versionId: string;
  versionNo: number;
  payload: PagePayload;
  outline: OutlineSection[];
  photoUrl: string | null;
  photoHash?: string;
  images: Record<string, string | null>;
  domain?: string;
  drafts: DraftComment[];
  onChange: (comments: DraftComment[]) => void;
  comments?: ReviewComment[];
  locked: boolean;
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [pin, setPin] = useState(false);
  const [selection, setSelection] = useState<{
    anchor: CommentAnchor;
    x: number;
    y: number;
  } | null>(null);
  const [editing, setEditing] = useState<DraftComment | null>(null);
  const [replacement, setReplacement] = useState<{
    anchor: CommentAnchor;
    current?: string | null;
  } | null>(null);
  const [, refreshLayout] = useState(0);
  const [filter, setFilter] = useState('All');
  useEffect(() => {
    const resize = () => refreshLayout(value => value + 1);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const [sheet, setSheet] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [badges, setBadges] = useState<{
    id: string;
    number: number;
    left: number;
    top: number;
  }[]>([]);
  const origin = useRef<HTMLElement | null>(null);
  const local = drafts.filter(comment => comment.itemId === itemId && comment.versionId === versionId);
  const entries: (ReviewComment & {
    draft?: DraftComment;
  })[] = [...comments.map(comment => ({ ...comment, draft: undefined as DraftComment | undefined })), ...local.map(draft => ({ id: draft.id, anchor: draft, body: draft.body, quote: draft.quote, state: 'unsent', versionNo, draft, suggestedImageUrl: draft.previewUrl }))];
  function begin(anchor: CommentAnchor) {
    if (locked)
      return;
    origin.current = document.activeElement as HTMLElement;
    setEditing({ ...anchor, id: crypto.randomUUID(), itemId, versionId, body: '' });
    setSelection(null);
    setSheet(true);
    setPin(false);
  }
  useEffect(() => {
    if (sheet && !editing && window.matchMedia('(max-width: 768px)').matches) document.querySelector<HTMLButtonElement>('#your-comments button')?.focus();
  }, [sheet, editing]);
  useEffect(() => {
    if (editing)
      composer.current?.focus();
  }, [editing]);
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (event.key === 'Tab' && sheet && window.matchMedia('(max-width: 768px)').matches) {
        const elements = Array.from(document.getElementById('your-comments')?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input, a[href]') ?? []);
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      if (event.key === 'Escape') {
        setPin(false);
        setEditing(null);
        setSheet(false);
        setSelection(null);
        origin.current?.focus();
      }
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'm' && selection) {
        event.preventDefault();
        begin(selection.anchor);
      }
    }
    document.addEventListener('keydown', keys);
    document.addEventListener('selectionchange', capture);
    return () => {
      document.removeEventListener('keydown', keys);
      document.removeEventListener('selectionchange', capture);
    };
  });
  function capture() {
    if (locked || editing || pin)
      return;
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount)
      return;
    const range = selected.getRangeAt(0);
    const element = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement;
    const content = element?.closest<HTMLElement>('[data-comment-content]');
    if (!content || !root.current?.contains(content))
      return;
    const node = sanitizeDoc(payload.body).content.find(node => node.attrs?.blockId === content.dataset.commentContent);
    const hash = outline.flatMap(section => section.blocks).find(block => block.blockId === node?.attrs?.blockId)?.hash;
    if (!node || !hash)
      return;
    try {
      const anchor = selectionAnchor(range, content, node, hash);
      const rect = range.getBoundingClientRect();
      setSelection({ anchor, x: Math.max(8, Math.min(rect.left, window.innerWidth - 130)), y: Math.max(8, rect.top - 52) });
    }
    catch {
      setSelection(null);
    }
  }
  function blockPin(node: PageNode): CommentAnchor {
    return { anchorKind: 'pin', pinTarget: 'block', blockId: String(node.attrs?.blockId), sectionId: String(node.attrs?.sectionId), targetHash: outline.flatMap(section => section.blocks).find(block => block.blockId === node.attrs?.blockId)?.hash };
  }
  function tools(anchor: CommentAnchor, current?: string | null) {
    const pending = local.find(comment => comment.suggestedImageReservationId && comment.blockId === anchor.blockId && comment.pinTarget === anchor.pinTarget);
    return <div className="flex flex-wrap gap-2" data-comment-tools>
      {anchor.pinTarget === 'mockup' && entries.filter(comment => comment.anchor.pinTarget === 'mockup').map(comment => <button key={comment.id} className="mockup-marker" aria-label={`Open comment ${entries.indexOf(comment) + 1} on mockup image`} onClick={() => {
        setActive(comment.id);
        setSheet(true);
      }}>{entries.indexOf(comment) + 1}</button>)}
      <button className={control} disabled={locked} onClick={() => begin(anchor)}>Pin</button>
      <button className={control} disabled={locked} onClick={() => setReplacement({ anchor, current })}>{pending ? 'Change' : 'Replace image'}</button>
      {pending && <><span className="rounded border border-[#B35A00] p-2">Replacement suggested</span><img className="h-12 w-12 object-cover" src={pending.previewUrl} alt="Suggested replacement" /><button className={control} onClick={() => onChange(drafts.filter(comment => comment.id !== pending.id))}>Undo</button></>}
    </div>;
  }
  function decorate(node: PageNode, children: ReactNode) {
    const blockId = String(node.attrs?.blockId);
    const anchored = entries.filter(comment => comment.anchor.blockId === blockId && comment.state !== 'earlier');
    return <div className={`comment-block ${pin ? 'pin-mode' : ''}`}>
      <div tabIndex={0} aria-label={`${node.type}: ${blockText(node).slice(0, 100)}`} aria-describedby={anchored.map(comment => `comment-${comment.id}`).join(' ') || undefined} data-comment-content={blockId} onClick={event => {
        if (pin) {
          event.preventDefault();
          begin(blockPin(node));
        }
      }}>
        {children}
      </div>
      <div className="comment-block-tools" data-comment-tools><button className={control} disabled={locked} onClick={() => begin(blockPin(node))}>Comment on this section</button></div>
      {node.type === 'image' && tools(blockPin(node), images[String(node.attrs?.src)] ?? String(node.attrs?.src))}
      {anchored.map((comment, index) => <button key={comment.id} style={{ top: index * 52 }} className={`comment-marker ${comment.anchor.anchorKind === 'highlight' ? 'highlight-marker' : ''} ${comment.state === 'text_changed' ? 'changed-marker' : ''}`} aria-label={`Open comment ${entries.indexOf(comment) + 1}: ${comment.anchor.anchorKind}`} onClick={() => {
        setActive(comment.id);
        setSheet(true);
        document.getElementById(`comment-${comment.id}`)?.scrollIntoView({ block: 'nearest' });
      }}>{entries.indexOf(comment) + 1}</button>)}
    </div>;
  }
  // Paint text ranges without replacing the DOM or losing links, formatting, or overlapping anchors.
  useEffect(() => {
    const registry = (CSS as unknown as {
      highlights?: Map<string, unknown>;
    }).highlights;
    const HighlightClass = (window as unknown as {
      Highlight?: new (...ranges: Range[]) => unknown;
    }).Highlight;
    if (!registry || !HighlightClass || !root.current)
      return;
    const ranges: Range[] = [];
    const nextBadges: typeof badges = [];
    const bounds = root.current.getBoundingClientRect();
    const activeRanges: Range[] = [];
    for (const comment of entries) {
      if (comment.anchor.anchorKind !== 'highlight' || !['same', 'rehighlighted', 'moved', 'unsent'].includes(comment.state))
        continue;
      const element = Array.from(root.current.querySelectorAll<HTMLElement>('[data-comment-content]')).find(element => element.dataset.commentContent === comment.anchor.blockId);
      if (!element)
        continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      while (walker.nextNode())
        textNodes.push(walker.currentNode as Text);
      // Map normalized code points to original DOM positions, including collapsed whitespace.
      const positions: {
        node: Text;
        start: number;
        end: number;
      }[] = [];
      let whitespace = false;
      for (const text of textNodes) {
        let offset = 0;
        for (const char of text.data) {
          if (!/\s/.test(char) || !whitespace && positions.length)
            positions.push({ node: text, start: offset, end: offset + char.length });
          whitespace = /\s/.test(char);
          offset += char.length;
        }
      }
      const first = positions[comment.anchor.rangeStart ?? -1];
      const last = positions[(comment.anchor.rangeEnd ?? 0) - 1];
      if (first && last) {
        const range = document.createRange();
        range.setStart(first.node, first.start);
        range.setEnd(last.node, last.end);
        ranges.push(range);
        const rect = Array.from(range.getClientRects()).at(-1);
        if (rect) {
          let top = rect.top - bounds.top;
          let left = Math.min(rect.right - bounds.left, bounds.width - 18);
          while (nextBadges.some(badge => Math.abs(badge.top - top) < 18 && Math.abs(badge.left - left) < 18)) {
            left += 18;
            if (left > bounds.width - 18) {
              left = Math.min(rect.right - bounds.left, bounds.width - 18);
              top += 18;
            }
          }
          nextBadges.push({ id: comment.id, number: entries.indexOf(comment) + 1, left, top });
        }
        if (active === comment.id)
          activeRanges.push(range);
      }
    }
    setBadges(previous => JSON.stringify(previous) === JSON.stringify(nextBadges) ? previous : nextBadges);
    registry.set('approval-comments', new HighlightClass(...ranges));
    registry.set('approval-active', new HighlightClass(...activeRanges));
    return () => {
      registry.delete('approval-comments');
      registry.delete('approval-active');
    };
  });
  return <div ref={root} onLoadCapture={() => refreshLayout(value => value + 1)} onMouseUp={capture} onTouchEnd={() => setTimeout(capture, 100)} className="page-comments-layout">
    <div>
      {comments.length > 0 && <div className="mb-4 rounded border border-[#0E6670] bg-[#E6F2F3] p-4"><strong>Revision ready</strong><p>Review version {versionNo}. Your earlier comments are kept below.</p></div>}
      <div className="mb-4 flex gap-3"><a href="#your-comments" className={control} onClick={() => setSheet(true)}>Comments ({entries.length})</a><button className={control} aria-pressed={pin} disabled={locked} onClick={() => setPin(!pin)}>Add pin{pin ? ' · On' : ''}</button></div>
      {pin && <p role="status">Tap a section or image to add a pin. Press Esc to stop.</p>}
      <PagePreview onMockupPin={pin && photoHash ? () => begin({ anchorKind: 'pin', pinTarget: 'mockup', targetHash: photoHash }) : undefined} payload={payload} photoUrl={photoUrl} images={images} domain={domain} decorateBlock={decorate} mockupTools={photoHash ? tools({ anchorKind: 'pin', pinTarget: 'mockup', targetHash: photoHash }, photoUrl) : undefined} />
    </div>
    {badges.map(badge => <span key={badge.id} aria-hidden="true" className="highlight-number" data-number={badge.number} style={{ left: badge.left, top: badge.top }} />)}
    {selection && <><button className="selection-chip" style={{ left: selection.x, top: selection.y }} onMouseDown={event => event.preventDefault()} onClick={() => begin(selection.anchor)}>Comment</button><button className="selection-bar" onClick={() => begin(selection.anchor)}>Comment on selected text</button></>}
    <div className="space-y-5">
      <aside id="your-comments" className={`comments-rail ${sheet ? 'comments-open' : ''}`} aria-label="Your comments" role={sheet ? 'dialog' : undefined}>
        <button className={`${control} comments-close`} onClick={() => {
          setSheet(false);
          setEditing(null);
        }}>Close comments</button>
        <h2 className="text-xl font-bold">Your comments ({entries.length})</h2>
        <div className="flex flex-wrap gap-1">{['All', 'Highlights', 'Pins', 'Images'].map(value => <button key={value} className={control} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div>
        {editing && <form className="space-y-3 rounded-xl border p-4" onSubmit={event => {
          event.preventDefault();
          onChange([...drafts.filter(comment => comment.id !== editing.id), editing]);
          setEditing(null);
        }}>
          <h3 className="font-bold">{editing.anchorKind === 'highlight' ? 'Comment on selected text' : 'Pin comment'}</h3>
          {editing.quote && <blockquote className="comment-quote">“{editing.quote}”</blockquote>}
          <label>Comment<textarea ref={composer} required={!editing.suggestedImageReservationId} maxLength={4000} className="block w-full rounded border p-3" value={editing.body} onChange={event => setEditing({ ...editing, body: event.target.value })} /></label>
          {editing.anchorKind === 'highlight' && <label>Suggest new wording (optional)<textarea maxLength={4000} className="block w-full rounded border p-3" value={editing.suggestedText ?? ''} onChange={event => setEditing({ ...editing, suggestedText: event.target.value || undefined })} /></label>}
          <p>Not sent yet. Included when you send your review.</p><button className={control}>Save comment</button><button type="button" className={control} onClick={() => setEditing(null)}>Cancel</button>
        </form>}
        {entries.filter(comment => filter === 'All' || (filter === 'Highlights' ? comment.anchor.anchorKind === 'highlight' : filter === 'Images' ? !!comment.suggestedImageUrl : comment.anchor.anchorKind === 'pin')).map(comment => <article id={`comment-${comment.id}`} key={comment.id} className={`my-3 rounded-xl border p-4 ${active === comment.id ? 'border-[#0B57D0]' : ''}`}>
          <h3 className="font-bold">{entries.indexOf(comment) + 1}. {comment.suggestedImageUrl ? 'Image suggestion' : comment.anchor.anchorKind === 'highlight' ? 'Highlight' : 'Pin'}</h3>
          {comment.state === 'earlier' && <h4>Earlier comments</h4>}
          {comment.state === 'text_changed' && <p className="border-l-2 border-[#B35A00] pl-2">Text changed since v{comment.versionNo}</p>}
          {comment.state === 'moved' && <p>Moved</p>}
          {comment.state === 'image_changed' && <p>Image changed since v{comment.versionNo}</p>}
          {comment.addressed && !comment.addressedVersion && <p>Addressed</p>}
          {comment.addressedVersion && <p>Addressed in version {comment.addressedVersion}</p>}
          {comment.quote && <blockquote className="comment-quote">“{comment.quote}”</blockquote>}
          <p className="whitespace-pre-wrap">{comment.body}</p>
          {comment.draft?.suggestedText && <p>Suggested wording: {comment.draft.suggestedText}</p>}
          {comment.reply && <p>Answered: {comment.reply}</p>}
          {comment.suggestedImageUrl && <img className="max-h-32" src={comment.suggestedImageUrl} alt="Suggested replacement" />}
          {comment.draft && <><p>Not sent yet</p><button className={control} onClick={() => {
            setEditing(comment.draft!);
            setSheet(true);
          }}>Edit</button><button className={control} onClick={() => onChange(drafts.filter(draft => draft.id !== comment.id))}>Delete</button></>}
        </article>)}
      </aside>
      {children}
    </div>
    {replacement && <ReplaceImage token={token} itemId={itemId} versionId={versionId} current={replacement.current} onClose={() => setReplacement(null)} onSave={(id, url, body) => {
      onChange([...drafts.filter(comment => !(comment.itemId === itemId && comment.suggestedImageReservationId && comment.blockId === replacement.anchor.blockId && comment.pinTarget === replacement.anchor.pinTarget)), { ...replacement.anchor, id: crypto.randomUUID(), itemId, versionId, body, suggestedImageReservationId: id, previewUrl: url }]);
      setReplacement(null);
    }} />}
  </div>;
}
