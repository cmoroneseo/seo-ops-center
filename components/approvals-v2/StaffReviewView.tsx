'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Eye, Lock, MessageSquare, MoreHorizontal, Pencil, Send,
} from 'lucide-react';
import { monthDay } from '@/components/gbp-approvals/sample';
import { typeLabel } from '@/lib/approvals-v2/list';
import { versionPhotoPaths } from '@/lib/gbp-approvals/photos';
import {
  characterCount, filterReviewItems, nextUnreviewed, reviewCounts, reviewFilters, reviewNoteLimit, reviewShortcut,
  reviewStatus, staffReviewBlockers, staffReviewTags, type ReviewFilter, type StaffDecision, type StaffReviewTag,
} from '@/lib/approvals-v2/staff-review';
import { PreviewDialog } from './PreviewDialog';
import { ItemErrorBoundary } from './ItemErrorBoundary';
import { StaffItemPreview, ReviewChip, ReviewThumbnail, reviewDate, reviewTypeName, statusText } from './StaffReviewPreview';
import { RequestEditForm, ReviewDialog, ReviewItemEditor } from './StaffReviewDialogs';
import { type StaffReviewData, type StaffReviewItem, type ReviewAction, type SaveStaffReview, displayVersion, itemTypeName } from './StaffReviewTypes';

const tabNames: Record<ReviewFilter, string> = { all: 'All', pending: 'To review', changes_requested: 'Changes', approved: 'Approved' };
const emptyFilters: Record<ReviewFilter, string> = { all: 'This request has no items yet', pending: 'No items to review', changes_requested: 'No items need changes', approved: 'No items approved' };
const keyCommands = [
  ['J', 'Next item'], ['K', 'Previous item'], ['A', 'Approve + next'],
  ['R', 'Request changes'], ['E', 'Edit item'], ['Space', 'Enlarge media'], ['?', 'Open keyboard shortcuts'],
];
const noAction: ReviewAction = async () => false;
const mobileQuery = '(max-width: 760px)';
const noteRequired = 'Add a short note so the writer knows what to change';
const textInput = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function Progress({ counts, items, draft, compact = false }: {
  counts: ReturnType<typeof reviewCounts>; items: StaffReviewItem[]; draft: boolean; compact?: boolean;
}) {
  const reviewed = counts.approved + counts.changes_requested;
  const label = `${reviewed} of ${counts.all} reviewed`;
  return <div className={compact ? 'ar-progress ar-progress-compact' : 'ar-progress'}>
    <strong>{label}</strong>
    <div className="ar-progress-track" data-many={items.length > 16 || undefined} role="progressbar"
      aria-label={`Progress: ${label}`} aria-valuemin={0} aria-valuemax={counts.all} aria-valuenow={reviewed}
      aria-valuetext={`${label}: ${counts.approved} approved, ${counts.changes_requested} changes requested`}>
      {items.map(item => <i key={item.id} data-status={reviewStatus(item, draft)} />)}
    </div>
    {!compact && reviewed > 0 && <div className="ar-legend">
      {counts.approved > 0 && <span className="ar-positive"><CheckCircle2 size={14} aria-hidden />{counts.approved} approved</span>}
      {counts.changes_requested > 0 && <span className="ar-amber"><Pencil size={14} aria-hidden />
        {counts.changes_requested} {counts.changes_requested === 1 ? 'change' : 'changes'}
      </span>}
    </div>}
  </div>;
}

function KeyboardList() {
  return <dl className="ar-key-grid">
    {keyCommands.map(([key, action]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{action}</dd></div>)}
  </dl>;
}

function menuItems(element: HTMLDivElement | null) {
  return [...(element?.querySelectorAll<HTMLElement>('button:not(:disabled), a') ?? [])]
    .filter(item => getComputedStyle(item).display !== 'none');
}

function ReviewMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menuItems(menu.current)[0]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);
  function onMenuKey(event: ReactKeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    const items = menuItems(menu.current);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  }
  return <div className="ar-menu" ref={wrapper} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button type="button" className="ar-icon-ghost" ref={trigger} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
      <MoreHorizontal size={20} aria-hidden />
    </button>
    {open && <div className="ar-menu-content" ref={menu} role="menu" aria-label={label} onKeyDown={onMenuKey}
      onClick={event => {
        if (!(event.target as HTMLElement).closest('[role="menuitem"]')) return;
        setOpen(false);
        trigger.current?.focus();
      }}>{children}</div>}
  </div>;
}

interface ViewProps {
  data: StaffReviewData;
  initialSelection?: string;
  initialMobileScreen?: 'list' | 'detail';
  act?: ReviewAction;
  saveReview?: SaveStaffReview;
  refresh?: () => Promise<void>;
  busy?: boolean;
  sending?: boolean;
  error?: string;
  notice?: string;
  children?: ReactNode;
}

export function StaffReviewView({ data, initialSelection, initialMobileScreen = 'list', act = noAction, saveReview, refresh,
  busy = false, sending = false, error, notice, children }: ViewProps) {
  const draft = data.request.stage === 'draft';
  const editable = data.canWrite && !data.request.archived_at;
  const canSend = !busy && data.canSend && !!data.items.length && !data.request.archived_at;
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [pointerTransition, setPointerTransition] = useState<{ previewId?: string; reviewedId?: string }>({});
  const [selection, setSelection] = useState(initialSelection ?? nextUnreviewed(data.items, '')?.id ?? data.items[0]?.id);
  const [screen, setScreen] = useState(initialMobileScreen);
  const [completion, setCompletion] = useState(draft && !initialSelection && !!data.items.length && !nextUnreviewed(data.items, ''));
  const [dialog, setDialog] = useState<'shortcuts' | 'request' | 'edit' | 'returnToDraft' | null>(null);
  const [singleKeysOff, setSingleKeysOff] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [mobileMenuSlot, setMobileMenuSlot] = useState<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState({ id: 0, text: '' });
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState<StaffDecision | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ itemId: string; versionId: string; text: string; tags: StaffReviewTag[] } | null>(null);
  const [noteError, setNoteError] = useState('');
  const [failedVersion, setFailedVersion] = useState<string | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const noteButton = useRef<HTMLButtonElement>(null);
  const itemTitle = useRef<HTMLHeadingElement>(null);
  const completeTitle = useRef<HTMLHeadingElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const noteReturnFocus = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const savedListScroll = useRef(0);
  const focusAfter = useRef<'approve' | 'row' | 'title' | 'completion' | 'note' | null>(null);
  const counts = reviewCounts(data.items, draft);
  const filtered = filterReviewItems(data.items, filter, draft);
  const selected = filtered.find(item => item.id === selection) ?? filtered[0];
  const version = selected ? displayVersion(selected, draft) : null;
  const number = selected ? data.items.indexOf(selected) + 1 : 0;
  const blockers = selected && draft ? staffReviewBlockers(selected.item_type, selected.page_kind, version?.payload,
    versionPhotoPaths(version?.photo_paths, version?.photo_path), version?.video_path) : [];
  const selectedStatus = selected ? reviewStatus(selected, draft) : 'pending';
  const showCompletion = draft && completion && counts.all > 0 && counts.pending === 0;
  const mobileScreen = selected || showCompletion ? screen : 'list';
  const singleChange = showCompletion && counts.changes_requested === 1
    ? data.items.find(item => reviewStatus(item, draft) === 'changes_requested') : undefined;
  const next = selected && draft ? nextUnreviewed(data.items, selected.id) : undefined;
  const selectedIndex = selected ? filtered.indexOf(selected) : -1;
  const note = noteDraft?.itemId === selected?.id && noteDraft?.versionId === version?.id ? noteDraft : null;
  const editableReview = draft && editable && !data.staffReviewUnavailable;
  const broken = !version || failedVersion === version.id;
  const unavailable = !editableReview || !saveReview;
  const reason = broken ? 'This item couldn’t be loaded.' : blockers.map(blocker => blocker.reason).join(' ');
  const shortcutStorageKey = `approvals:single-key-shortcuts-off:${data.actorId ?? 'staff'}`;

  function announce(text: string) {
    setAnnouncement(previous => ({ id: previous.id + 1, text }));
  }

  function rowButton(id: string | undefined) {
    return [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-review-row]') ?? [])].find(button => button.dataset.reviewRow === id);
  }

  function scroller() {
    return root.current?.closest<HTMLElement>('[data-approval-scroll]') ?? document.scrollingElement;
  }

  useEffect(() => {
    const query = window.matchMedia(mobileQuery);
    const change = () => {
      setMobile(query.matches);
      setMobileMenuSlot(query.matches ? document.getElementById('ar-mobile-top-more') : null);
    };
    change();
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const pointer = () => html.removeAttribute('data-keys');
    document.addEventListener('pointerdown', pointer, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      html.removeAttribute('data-keys');
    };
  }, []);

  useEffect(() => {
    try { setSingleKeysOff(localStorage.getItem(shortcutStorageKey) === 'true'); } catch { /* Keep the current preference if storage is unavailable. */ }
  }, [shortcutStorageKey]);

  useEffect(() => {
    const focus = focusAfter.current;
    focusAfter.current = null;
    if (focus === 'title' || focus === 'completion') {
      if (mobile) scroller()?.scrollTo({ top: 0, behavior: 'instant' });
      (focus === 'title' ? itemTitle : completeTitle).current?.focus({ preventScroll: mobile });
    } else if (focus === 'approve') {
      (approveButton.current ?? noteButton.current)?.focus({ preventScroll: true });
    } else if (focus === 'row') {
      rowButton(selected?.id)?.focus({ preventScroll: true });
    } else if (focus === 'note') {
      textarea.current?.focus();
    }
    if (focus && focus !== 'note' && !(mobile && screen === 'detail')) {
      rowButton(selected?.id)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  });

  useEffect(() => {
    const view = root.current;
    const scroll = view?.closest<HTMLElement>('[data-approval-scroll]');
    if (!mobile || !view || typeof ResizeObserver === 'undefined') return;
    const bar = view.querySelector(mobileScreen === 'list' ? '.ar-mobile-send' : '.ar-footer-wrap, .ar-post-send');
    if (!bar) return;
    const update = () => {
      const padding = `${Math.ceil(bar.getBoundingClientRect().height) + 16}px`;
      view.style.setProperty('--ar-fixed-bar-clearance', padding);
      scroll?.style.setProperty('--ar-fixed-bar-clearance', padding);
    };
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      view.style.removeProperty('--ar-fixed-bar-clearance');
      scroll?.style.removeProperty('--ar-fixed-bar-clearance');
    };
  }, [mobile, mobileScreen, draft, counts.all, note, selected?.id, editable, broken, showCompletion]);

  useEffect(() => {
    pane.current?.querySelector('.ar-pane-body')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [version?.id]);

  function openDialog(name: NonNullable<typeof dialog>, trigger?: HTMLElement) {
    returnFocus.current = trigger ?? document.activeElement as HTMLElement;
    setDialog(name);
  }

  function closeDialog() {
    setDialog(null);
    requestAnimationFrame(() => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      else rowButton(selected?.id)?.focus();
    });
  }

  function discardNote() {
    if (savingRef.current) return false;
    if (note?.text.trim() && !window.confirm('Discard this review note?')) return false;
    setNoteDraft(null);
    setNoteError('');
    return true;
  }

  function cancelNote() {
    if (discardNote()) requestAnimationFrame(() => (noteReturnFocus.current?.isConnected ? noteReturnFocus.current : noteButton.current)?.focus());
  }

  function select(item: StaffReviewItem, source: 'click' | 'list' | 'nav', pointer = false) {
    if (item.id !== selected?.id && !discardNote()) return;
    setSaveError('');
    setCompletion(false);
    setPointerTransition(pointer && item.id !== selected?.id ? { previewId: item.id } : {});
    setSelection(item.id);
    if (mobile && (source === 'click' || screen === 'detail')) {
      if (screen === 'list') savedListScroll.current = scroller()?.scrollTop ?? 0;
      setScreen('detail');
      focusAfter.current = 'title';
    } else if (source === 'list') {
      focusAfter.current = 'row';
    } else if (source === 'nav') {
      rowButton(item.id)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }

  function backToList() {
    if (!discardNote()) return;
    setScreen('list');
    requestAnimationFrame(() => {
      scroller()?.scrollTo({ top: savedListScroll.current, behavior: 'instant' });
      rowButton(selected?.id)?.focus({ preventScroll: true });
    });
  }

  function chooseFilter(nextFilter: ReviewFilter) {
    if (!discardNote()) return false;
    const matching = filterReviewItems(data.items, nextFilter, draft);
    setPointerTransition({});
    setSelection(matching.find(item => item.id === selected?.id)?.id ?? matching[0]?.id);
    setFilter(nextFilter);
    setCompletion(false);
    setSaveError('');
    return true;
  }

  function edit(trigger?: HTMLElement) {
    if (editable && selected?.version && !busy && discardNote()) openDialog('edit', trigger);
  }

  function openNote(prefill = false, trigger?: HTMLElement) {
    if (!selected || !version || unavailable || broken || busy || savingRef.current) return;
    noteReturnFocus.current = trigger ?? noteButton.current;
    setSaveError('');
    setNoteError('');
    setNoteDraft({
      itemId: selected.id, versionId: version.id,
      text: prefill ? selected.staffReview?.note ?? '' : '',
      tags: prefill ? selected.staffReview?.tags ?? [] : [],
    });
    focusAfter.current = 'note';
  }

  async function decide(decision: StaffDecision, source: 'button' | 'keyboard' | 'note', pointer = false) {
    if (!saveReview || !selected || !version || unavailable || busy || savingRef.current) return;
    if (broken || decision === 'approved' && blockers.length) {
      announce(`Can’t ${decision === 'approved' ? 'approve' : 'save'}: ${reason}`);
      return;
    }
    if (decision === 'approved' && selectedStatus === 'approved') return;
    const noteText = note?.text.trim();
    if (decision === 'changes_requested' && (!noteText || characterCount(noteText) > reviewNoteLimit)) {
      setNoteError(noteText ? 'Keep your note to 4,000 characters or fewer.' : noteRequired);
      textarea.current?.focus();
      return;
    }
    const inList = list.current?.contains(document.activeElement);
    savingRef.current = true;
    setSaving(decision);
    setSaveError('');
    try {
      await saveReview({ itemId: selected.id, versionId: version.id, decision,
        ...(decision === 'changes_requested' && note ? { note: note.text.trim(), tags: note.tags } : {}) });
      setNoteDraft(null);
      setPointerTransition(pointer ? { previewId: next?.id, reviewedId: selected.id } : {});
      if (next) {
        if (filter !== 'all' && filter !== 'pending') setFilter('pending');
        setSelection(next.id);
        const nextNumber = data.items.indexOf(next) + 1;
        const headline = displayVersion(next, true)?.payload.title ?? 'Untitled item';
        announce(`${decision === 'approved' ? 'Approved' : 'Changes requested'}. Moved to item ${nextNumber} of ${counts.all}: ${headline}.`);
        focusAfter.current = mobile ? 'title' : source === 'keyboard' ? (inList ? 'row' : null) : 'approve';
        if (!focusAfter.current) rowButton(next.id)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      } else {
        setCompletion(true);
        focusAfter.current = 'completion';
        announce(`All ${counts.all} items reviewed.`);
      }
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Couldn’t save. Try again.');
      if (source === 'button') focusAfter.current = 'approve';
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  }

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const inList = !!target && !!list.current?.contains(target);
      const inDialog = !!document.querySelector('[role="dialog"][data-state="open"]:not(.ar-note-dialog), [role="alertdialog"][data-state="open"], .ar-menu-content');
      const action = reviewShortcut(event, { typing: !!target?.closest(textInput), inList, dialog: inDialog, note: !!note, inNote: !!target?.closest('.ar-note-form'), singleKeysOff });
      if (!action) return;
      const step = { next: selectedIndex + 1, previous: selectedIndex - 1, first: 0, last: filtered.length - 1 };
      if (action in step) {
        event.preventDefault();
        document.documentElement.dataset.keys = '1';
        const targetItem = filtered[step[action as keyof typeof step]];
        if (targetItem) select(targetItem, inList ? 'list' : 'nav');
      } else if (action === 'help') {
        event.preventDefault();
        openDialog('shortcuts');
      } else if (action === 'cancelNote') {
        event.preventDefault();
        cancelNote();
      } else if (action === 'submitNote') {
        event.preventDefault();
        document.documentElement.dataset.keys = '1';
        void decide('changes_requested', 'note');
      } else if ((!mobile || screen === 'detail') && !showCompletion) {
        event.preventDefault();
        if (action === 'approve' || action === 'changes') document.documentElement.dataset.keys = '1';
        if (action === 'approve') void decide('approved', 'keyboard');
        if (action === 'changes') openNote();
        if (action === 'edit') edit();
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });

  function navButtons() {
    return <div className="ar-prev-next">
      {[
        { label: 'Previous item', Icon: ChevronUp, item: filtered[selectedIndex - 1] },
        { label: 'Next item', Icon: ChevronDown, item: filtered[selectedIndex + 1] },
      ].map(({ label, Icon, item }) => <button key={label} type="button" className="ar-icon-ghost"
        aria-label={label} aria-disabled={!item || !!saving} onClick={event => { if (item && !saving) select(item, 'nav', event.detail > 0); }}>
        <Icon size={18} aria-hidden />
      </button>)}
    </div>;
  }

  function sendButton() {
    return <button className={`ar-button ar-send ${counts.approved > 0 ? 'ar-send-hot' : 'ar-send-ink'}`} type="button" disabled={!canSend} aria-busy={sending}
      aria-describedby={data.canSend ? undefined : 'ar-send-permission'} onClick={() => void act('send')}>
      <Send size={18} aria-hidden />{sending ? 'Creating link…' : 'Send and create link'}
    </button>;
  }

  function previewButton() {
    return <PreviewDialog logoSrc={data.request.clients?.logo_url ?? undefined} domain={data.request.clients?.domain}
      clientName={data.request.clients?.name ?? 'Client'}
      trigger={<button type="button" className="ar-button ar-button-ghost"><Eye size={16} aria-hidden /><span>Preview as client</span></button>}
      items={data.items.flatMap(item => {
        const current = displayVersion(item, draft);
        return current ? [{
          id: item.id, payload: current.payload, images: data.photos,
          photoUrl: data.photos[current.photo_path ?? ''] ?? null,
          videoSrc: current.video_path ? data.photos[current.video_path] ?? null : undefined,
          videoPosterSrc: data.photos[current.video_poster_path ?? ''],
          photoUrls: versionPhotoPaths(current.photo_paths, current.photo_path).map(path => data.photos[path] ?? null),
        }] : [];
      })} />;
  }

  const noteForm = note && <form className="ar-note-form" noValidate onSubmit={event => { event.preventDefault(); void decide('changes_requested', 'note', !document.documentElement.hasAttribute('data-keys')); }}>
    <label htmlFor="ar-review-note">What should change?</label>
    <textarea ref={textarea} id="ar-review-note" rows={3} required value={note.text} aria-invalid={!!noteError}
      aria-describedby={noteError ? 'ar-note-error' : undefined} onChange={event => {
        const text = event.currentTarget.value;
        setNoteDraft({ ...note, text });
        if (noteError && text.trim()) setNoteError('');
      }} />
    {noteError && <p id="ar-note-error" className="ar-error"><AlertTriangle size={16} aria-hidden />{noteError}</p>}
    <div className="ar-tags" aria-label="Optional review tags">
      {staffReviewTags.map(tag => <button key={tag} type="button" aria-pressed={note.tags.includes(tag)} disabled={!!saving}
        onClick={() => setNoteDraft({ ...note, tags: note.tags.includes(tag) ? note.tags.filter(value => value !== tag) : [...note.tags, tag] })}>{tag === 'cta' ? 'CTA' : tag}</button>)}
    </div>
    {saveError && <p role="alert" className="ar-error"><AlertTriangle size={16} aria-hidden />{saveError}</p>}
    <div className="ar-actions">
      <button className="ar-button ar-dark" type="submit" disabled={!!saving || busy} aria-busy={saving === 'changes_requested'}>{saving ? 'Sending…' : 'Send request'}</button>
      <button className="ar-button ar-text-button" type="button" disabled={!!saving} onClick={cancelNote}>Cancel</button>
      <span className="ar-fine ar-note-hint">⌘/Ctrl + Enter to send · Esc to cancel</span>
    </div>
  </form>;

  function reviewFooter(previewBroken = broken) {
    if (!draft) return selected && editable && <div className="ar-pane-footer ar-post-send">
      {selected.version && <button className="ar-button" disabled={busy} onClick={event => edit(event.currentTarget)}><Pencil size={16} aria-hidden />Edit · new version</button>}
      {selected.item_type === 'page' && selected.current_version_id !== selected.released_version_id &&
        <button className="ar-button" disabled={busy} onClick={() => void act('release')}>Release revision to client</button>}
      {selected.status !== 'pending' && !selected.decision_lock_reason &&
        <button className="ar-button" disabled={busy} onClick={() => void act('final', { itemId: selected.id })}>Mark final</button>}
    </div>;
    if (!editable) return null;
    if (note && !previewBroken) {
      return mobile ? <ReviewDialog className="ar-note-dialog" title="Request changes" onClose={cancelNote}
        initialFocus={() => textarea.current}>{noteForm}</ReviewDialog> : noteForm;
    }
    const disabled = unavailable || previewBroken || !!blockers.length || busy || !!saving;
    const disabledReason = previewBroken ? 'This item couldn’t be loaded.' : reason || (data.staffReviewUnavailable ? 'Staff reviews are temporarily unavailable.' : '');
    return <div className="ar-footer-wrap">
      {saveError && <p role="alert" className="ar-error ar-save-error"><AlertTriangle size={16} aria-hidden />{saveError}</p>}
      <div className="ar-pane-footer">
        <button type="button" ref={noteButton} className="ar-button ar-button-ghost" aria-disabled={unavailable || previewBroken || busy || !!saving} onClick={event => { if (!previewBroken) openNote(false, event.currentTarget); }}>
          <MessageSquare size={18} aria-hidden />Request changes{!singleKeysOff && <kbd>R</kbd>}
        </button>
        {selectedStatus === 'approved' ? <span className="ar-footer-approved"><Check size={18} aria-hidden />Approved</span> :
          <button type="button" ref={approveButton} className="ar-button ar-approve" aria-disabled={disabled} aria-busy={saving === 'approved'}
            aria-describedby={disabledReason ? 'ar-approve-reason' : undefined} onClick={event => { if (!previewBroken) void decide('approved', 'button', event.detail > 0); }}>
            <Check size={18} aria-hidden />{saving === 'approved' ? 'Approving…' : 'Approve'}{!singleKeysOff && saving !== 'approved' && <kbd>A</kbd>}
          </button>}
        {disabledReason ? <span id="ar-approve-reason" className="ar-fine ar-footer-reason"><AlertTriangle size={15} aria-hidden />{disabledReason}</span> :
          selectedStatus !== 'approved' && <span className="ar-fine ar-next-hint">{next ? `Approving moves you to item ${data.items.indexOf(next) + 1}` : 'Approving completes review'}</span>}
        {!singleKeysOff && <div className="ar-shortcut-hint"><span><kbd>J</kbd> <kbd>K</kbd> move</span><span><kbd>A</kbd> approve</span><span><kbd>R</kbd> changes</span>
          <button className="ar-help-inline" type="button" aria-label="Keyboard shortcuts" onClick={event => openDialog('shortcuts', event.currentTarget)}><kbd>?</kbd></button></div>}
      </div>
    </div>;
  }

  const numberText = `${number} of ${counts.all}`;
  const stage = counts.changes_requested ? 'changes_requested' : counts.all && !counts.pending ? 'approved' : 'pending';
  const type = typeLabel({ itemType: data.request.item_type, pageKinds: [...new Set(data.items.flatMap(item => item.page_kind ?? []))] });
  const itemLabel = counts.all === 1 && ['GBP posts', 'Pages'].includes(type) ? type.slice(0, -1)
    : counts.all !== 1 && !['GBP posts', 'Pages'].includes(type) ? `${type}s` : type;
  const dates = data.items.map(item => reviewDate(displayVersion(item, draft))).filter(date => !!date && !!monthDay(date)).sort();
  const firstDate = monthDay(dates[0]);
  const lastDate = monthDay(dates.at(-1));
  const dateRange = dates[0] === dates.at(-1) ? firstDate : `${firstDate} – ${lastDate}`;
  const meta = [
    data.request.clients?.name,
    `${counts.all} ${itemLabel}`,
    dateRange,
    draft ? <span className="ar-lock"><Lock size={13} aria-hidden />Draft — the client can’t see this yet</span> : statusText(stage, false),
    data.request.archived_at && 'Archived',
  ].filter(Boolean);
  const statusChips = selected ? <>
    {(!draft || selectedStatus !== 'pending') && <ReviewChip kind={selectedStatus}>{statusText(selectedStatus, draft)}</ReviewChip>}
    {blockers.map(blocker => <ReviewChip key={blocker.label} kind={blocker.label === 'Photo needed' ? 'photo' : 'blocker'}>{blocker.label}</ReviewChip>)}
  </> : null;

  const requestMenu = <ReviewMenu label="Request actions">
    {draft && editable && <button className="ar-mobile-menu-action" role="menuitem" onClick={event => openDialog('request', event.currentTarget.closest('.ar-menu')?.querySelector('button') ?? undefined)}>Edit details</button>}
    <p role="presentation">Owner: {data.owner?.full_name ?? data.botName ?? 'Unassigned'}</p>
    {editable && <button role="menuitem" disabled={busy} onClick={() => void act('owner', { ownerId: 'me' })}>Take ownership</button>}
    {data.request.stage === 'sent' && editable && <button role="menuitem" disabled={busy} onClick={event => openDialog('returnToDraft', event.currentTarget.closest('.ar-menu')?.querySelector('button') ?? undefined)}>Move back to draft</button>}
    {data.canWrite && <button role="menuitem" disabled={busy} onClick={() => void act(data.request.archived_at ? 'unarchive' : 'archive')}>
      {data.request.archived_at ? 'Unarchive' : 'Archive'}{draft ? ' draft' : ''}
    </button>}
    <button role="menuitem" onClick={event => openDialog('shortcuts', event.currentTarget.closest('.ar-menu')?.querySelector('button') ?? undefined)}>Keyboard shortcuts</button>
  </ReviewMenu>;

  const itemMenu = draft && editable && selected && <ReviewMenu label="Item actions">
    {([-1, 1] as const).map(direction => <button key={direction} role="menuitem" disabled={busy || number + direction < 1 || number + direction > counts.all} onClick={() => {
      const ids = data.items.map(item => item.id);
      const index = number - 1;
      [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
      void act('', { itemOrder: ids }, 'PATCH');
    }}>{direction === -1 ? 'Move up' : 'Move down'}</button>)}
    <button className="ar-error" role="menuitem" disabled={busy} onClick={() => void act('', { removeItemIds: [selected.id] }, 'PATCH')}>Remove from request</button>
  </ReviewMenu>;

  function previewError(retry?: () => void) {
    return <>
      <div className="ar-pane-body ar-preview-error">
        <h2 id="ar-item-title" tabIndex={-1} ref={itemTitle}><AlertTriangle size={20} aria-hidden /> Couldn’t load this item.</h2>
        <button type="button" className="ar-button" onClick={() => {
          setFailedVersion(null);
          retry?.();
          void refresh?.().catch(() => announce('Couldn’t reload this item.'));
        }}>Retry</button>
        {itemMenu}
      </div>
      {reviewFooter(true)}
    </>;
  }

  return <div ref={root} className="ar-view" data-mobile-screen={mobileScreen}>
    <div className="ar-mobile-detail-bar ar-mobile-detail">
      <button type="button" className="ar-back" onClick={backToList}><ChevronLeft size={20} aria-hidden />All items</button>
      {selected && !showCompletion && <><span>{numberText}</span>{navButtons()}</>}
    </div>
    <div className="ar-container">
      <header className="ar-page-header ar-mobile-list">
        <div>
          <Link className="ar-crumb" href="/approvals"><ChevronLeft size={14} aria-hidden />Approvals</Link>
          <h1>{data.request.title}</h1>
          <div className="ar-meta">
            {meta.map((entry, index) => <span className="ar-meta-entry" key={index}>{entry}</span>)}
          </div>
        </div>
        <div className="ar-header-actions">
          {previewButton()}
          {draft && editable && <button className="ar-button ar-text-button" onClick={event => openDialog('request', event.currentTarget)}>Edit details</button>}
          {mobileMenuSlot ? createPortal(requestMenu, mobileMenuSlot) : requestMenu}
          {draft && !!counts.all && sendButton()}
          {!draft && <a className="ar-button ar-button-soft" href="#ar-share">Share link</a>}
        </div>
      </header>
      <div role="status" aria-live="polite" className="sr-only"><span key={announcement.id}>{announcement.text}</span></div>
      {data.staffReviewUnavailable && <p className="ar-message">Staff review history could not be loaded.</p>}
      {data.internalFeedbackUnavailable && <p className="ar-message">Internal feedback could not be loaded.</p>}
      <div className="ar-tools ar-mobile-list">
        {!!counts.all && <Progress counts={counts} items={data.items} draft={draft} />}
        <div className="ar-tabs" role="tablist" aria-label="Filter items">
          {reviewFilters.map((key, index) => <button key={key} id={`ar-tab-${key}`} role="tab" aria-selected={key === filter}
            aria-controls="ar-items" tabIndex={key === filter ? 0 : -1} onClick={() => chooseFilter(key)}
            onKeyDown={event => {
              const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!offset) return;
              event.preventDefault();
              const target = reviewFilters[(index + offset + reviewFilters.length) % reviewFilters.length];
              if (chooseFilter(target)) root.current?.querySelector<HTMLElement>(`#ar-tab-${target}`)?.focus();
            }}>{tabNames[key]} <span>{counts[key]}</span></button>)}
        </div>
      </div>
      <div className="ar-mobile-list">
        {draft && !!counts.all && <div className="ar-mobile-send">
          <Progress counts={counts} items={data.items} draft={draft} compact />
          {sendButton()}
        </div>}
        {error && <p className="ar-error ar-message" role="alert"><AlertTriangle size={16} aria-hidden />{error}</p>}
        {notice && <p className="ar-message" role="status">{notice}</p>}
      </div>
      {error && screen === 'detail' && <p className="ar-error ar-message ar-mobile-detail ar-mobile-only" role="alert"><AlertTriangle size={16} aria-hidden />{error}</p>}
      <div className="ar-grid">
        <div className="ar-list-column ar-mobile-list">
          <section className="ar-list-card ar-card" aria-label="Items">
            <div ref={list} id="ar-items" role="tabpanel" aria-labelledby={`ar-tab-${filter}`}>
              {filtered.length ? <ol>
                {filtered.map(item => {
                  const active = !showCompletion && item.id === selected?.id;
                  const rowVersion = displayVersion(item, draft);
                  const title = rowVersion?.payload?.title || 'Untitled item';
                  const index = data.items.indexOf(item) + 1;
                  const date = monthDay(reviewDate(rowVersion));
                  const status = reviewStatus(item, draft);
                  const photoPaths = versionPhotoPaths(rowVersion?.photo_paths, rowVersion?.photo_path);
                  const rowBlockers = draft && rowVersion ? staffReviewBlockers(item.item_type, item.page_kind, rowVersion.payload, photoPaths, rowVersion.video_path) : [];
                  const photoNeeded = rowBlockers.some(blocker => blocker.label === 'Photo needed');
                  return <li key={item.id}>
                    <button type="button" className="ar-row" data-review-row={item.id} data-status={status} data-animate-review={pointerTransition.reviewedId === item.id || undefined} aria-current={active || undefined}
                      aria-label={[`Item ${index}: ${title}`, statusText(status, draft), ...rowBlockers.map(blocker => blocker.label), date].filter(Boolean).join(', ')}
                      onClick={event => select(item, 'click', event.detail > 0)}>
                      {status === 'approved'
                        ? <span className="ar-row-check" aria-hidden><CheckCircle2 size={18} strokeWidth={2.2} /></span>
                        : <span className="ar-row-number">{index}</span>}
                      <ReviewThumbnail item={item} version={rowVersion} photo={data.photos[rowVersion?.video_poster_path ?? photoPaths[0]] ?? null} blocked={photoNeeded} />
                      <span className="ar-row-copy"><span className="ar-row-title">{title}</span>
                        <span className="ar-row-meta">
                          {status !== 'pending' && <ReviewChip kind={status}>{status === 'approved' ? 'Approved' : 'Changes'}</ReviewChip>}
                          {rowBlockers.map(blocker => <ReviewChip key={blocker.label} kind={blocker.label === 'Photo needed' ? 'photo' : 'blocker'}>{blocker.label}</ReviewChip>)}
                          {date && <span>{date}</span>}
                        </span>
                      </span>
                      <ChevronRight className="ar-chevron" size={16} aria-hidden />
                    </button>
                  </li>;
                })}
              </ol> : <div className="ar-empty-list"><p>{counts.all ? emptyFilters[filter] : emptyFilters.all}</p>
                {counts.all > 0 && <button className="ar-button ar-text-button" onClick={() => chooseFilter('all')}>Show all</button>}
              </div>}
            </div>
          </section>
          {(!!counts.all || !draft) && <div className="ar-mobile-list-tools">
            {!!counts.all && previewButton()}
            {!draft && <a className="ar-button ar-button-soft" href="#ar-share">Share link</a>}
          </div>}
        </div>
        {(showCompletion || selected) && <section ref={pane} className="ar-card ar-pane ar-mobile-detail" data-animate-preview={Boolean(selected && pointerTransition.previewId === selected.id) || undefined} aria-labelledby={showCompletion ? 'ar-review-complete' : 'ar-item-title'}>
          {showCompletion ? <div className="ar-complete">
            <span className="ar-complete-mark"><Check size={32} aria-hidden /></span>
            <h2 tabIndex={-1} ref={completeTitle} id="ar-review-complete">All {counts.all} items reviewed</h2>
            <p className="ar-complete-summary">{counts.approved} approved{counts.changes_requested > 0 && ` · ${counts.changes_requested} needs changes`}</p>
            <div className="ar-actions">
              {sendButton()}
              {counts.changes_requested > 0 && <button className="ar-button ar-button-soft" onClick={event => {
                if (singleChange) {
                  setFilter('all');
                  select(singleChange, 'click', event.detail > 0);
                  focusAfter.current = 'title';
                } else if (chooseFilter('changes_requested')) {
                  if (mobile) setScreen('list');
                  focusAfter.current = mobile ? 'row' : 'title';
                }
              }}><Pencil size={16} aria-hidden />{singleChange
                ? `Review the change on item ${data.items.indexOf(singleChange) + 1}`
                : `Review changes (${counts.changes_requested})`}</button>}
            </div>
            <p className="ar-complete-fine">Private link · nothing is emailed · expires in 14 days</p>
          </div> : selected && <>
            <header className="ar-pane-header">
              <span>Item {numberText} · {reviewTypeName(selected, version)}{version && ` · v${version.version_no}`}</span>
              <div className="ar-pane-status">{statusChips}</div>
              <div className="ar-pane-nav">{navButtons()}</div>
            </header>
            {version ? <ItemErrorBoundary key={version.id} onError={() => setFailedVersion(version.id)} fallback={previewError}>
              <StaffItemPreview data={data} item={selected} version={version} position={number} draft={draft} canEdit={editable}
                edit={edit} editNote={trigger => openNote(true, trigger)} refresh={() => { void refresh?.().catch(() => announce('Couldn’t reload comments.')); }}
                status={statusChips} titleRef={itemTitle} itemMenu={itemMenu} />
              {reviewFooter()}
            </ItemErrorBoundary> : previewError()}
          </>}
        </section>}
      </div>
      <div className="ar-mobile-list">{children}</div>
    </div>
    {dialog === 'shortcuts' && <ReviewDialog title="Keyboard shortcuts" onClose={closeDialog}>
      <KeyboardList />
      <label className="ar-shortcut-toggle"><input type="checkbox" role="switch" checked={singleKeysOff} onChange={event => {
        setSingleKeysOff(event.currentTarget.checked);
        try { localStorage.setItem(shortcutStorageKey, String(event.currentTarget.checked)); } catch { /* Preference remains active for this view. */ }
      }} />Turn off single-key shortcuts</label>
    </ReviewDialog>}
    {dialog === 'request' && <ReviewDialog title="Edit request details" onClose={closeDialog}>
      {error && <p role="alert" className="ar-error">{error}</p>}
      <RequestEditForm data={data} busy={busy} act={act} onClose={closeDialog} />
    </ReviewDialog>}
    {dialog === 'returnToDraft' && <ReviewDialog title="Move back to draft?" onClose={closeDialog}
      description="Active client review links will stop working immediately. Existing items, versions, the current round, and feedback are kept. The client will receive no notification.">
      {error && <p role="alert" className="ar-error">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="ar-button" type="button" onClick={closeDialog}>Cancel</button>
        <button className="ar-button" type="button" disabled={busy} onClick={async () => {
          if (await act('return-to-draft')) closeDialog();
        }}>Move back to draft</button>
      </div>
    </ReviewDialog>}
    {dialog === 'edit' && selected && <ReviewDialog title={draft ? `Edit ${itemTypeName(selected, selected.version).toLowerCase()}` : 'Edit as a new version'}
      onClose={closeDialog} className="sm:max-w-3xl">
      {error && <p role="alert" className="ar-error">{error}</p>}
      <ReviewItemEditor data={data} item={selected} busy={busy} act={act} onClose={closeDialog} />
    </ReviewDialog>}
  </div>;
}
