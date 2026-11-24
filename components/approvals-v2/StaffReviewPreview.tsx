'use client';

import { useCallback, useRef, useState, type ReactNode, type Ref } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Clock, ExternalLink, FileText, Image as ImageIcon, Maximize2, Pencil, Send } from 'lucide-react';
import { GbpPostPreview } from '@/components/gbp-approvals/PublicReview';
import { monthDay, offerRange, weekday } from '@/components/gbp-approvals/sample';
import { nodeText, safeUrl, sanitizeDoc, type PageNode } from '@/lib/approvals-v2/page-doc';
import { characterCount, gbpCharacterLimit, isPhoneCta, type ReviewStatus } from '@/lib/approvals-v2/staff-review';
import { versionPhotoPaths } from '@/lib/gbp-approvals/photos';
import { feedbackLabel } from '@/lib/internal-review/model';
import { AgencyComments } from './AgencyComments';
import { PagePreview } from './PagePreview';
import { type StaffReviewData, type StaffReviewItem, type ReviewVersion, itemTypeName } from './StaffReviewTypes';
import { ReviewDialog } from './StaffReviewDialogs';

export const statusText = (status: ReviewStatus, draft: boolean) => status === 'approved' ? 'Approved'
  : status === 'changes_requested' ? 'Changes requested' : draft ? 'Needs review' : 'Waiting on client';

export function ReviewChip({ kind, children }: { kind: ReviewStatus | 'ready' | 'blocker' | 'photo'; children: ReactNode }) {
  const Icon = { approved: Check, changes_requested: Pencil, pending: Clock, ready: Send, blocker: AlertTriangle, photo: ImageIcon }[kind];
  return <span className={`ar-chip ar-chip-${kind}`}><Icon size={14} strokeWidth={2.4} aria-hidden />{children}</span>;
}

export function reviewDate(version: ReviewVersion | null) {
  return version?.payload && ('pageKind' in version.payload ? version.payload.plannedDate : version.payload.scheduledDate);
}

export function ReviewThumbnail({ item, version, photo, blocked }: { item: StaffReviewItem; version: ReviewVersion | null; photo: string | null; blocked: boolean }) {
  const blog = itemTypeName(item, version) === 'Blog draft';
  if (blog) {
    let words: number | undefined;
    try { words = wordCount(sanitizeDoc(version?.payload.body)); } catch { /* The selected pane has its own retry state. */ }
    return <span className="ar-thumbnail ar-thumbnail-icon ar-blog-thumbnail"><FileText size={18} aria-hidden />
      {words !== undefined && <span>{words.toLocaleString('en-US')}</span>}
    </span>;
  }
  const Icon = blocked || item.item_type === 'gbp_post' ? ImageIcon : FileText;
  // eslint-disable-next-line @next/next/no-img-element
  return photo ? <img className="ar-thumbnail" src={photo} alt="" /> :
    <span className={`ar-thumbnail ar-thumbnail-icon ${blocked ? 'ar-thumbnail-missing' : ''}`}><Icon size={20} aria-hidden /></span>;
}

function Meter({ length, limit, unit = 'characters' }: { length: number; limit: number; unit?: string }) {
  return <div className={`ar-meter ${length >= limit * 0.9 ? 'ar-meter-warning' : ''}`}>
    <span>{length >= limit * 0.9 && <AlertTriangle size={13} aria-hidden />} {length.toLocaleString('en-US')} / {limit.toLocaleString('en-US')}{length > limit ? ' · over limit' : ''}</span>
    <span className="ar-meter-track" aria-hidden><i style={{ width: `${Math.min(100, length / limit * 100)}%` }} /></span>
    <span>{unit}</span>
  </div>;
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="ar-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function FeedbackPhoto({ position, url }: { position?: number | null; url?: string | null }) {
  if (!position) return null;
  return <> · {url ? <a className="ar-fact-link" href={url} target="_blank" rel="noopener noreferrer">Photo {position}</a> : `Photo ${position}`}</>;
}

function wordCount(root: PageNode) {
  return nodeText(root).trim().split(/\s+/).filter(Boolean).length;
}

function documentFacts(root: PageNode, domain: string | undefined) {
  const headings: string[] = [];
  let links = 0;
  let images = 0;
  const baseUrl = pageUrl(domain, '');
  const hostname = baseUrl ? new URL(baseUrl).hostname.replace(/^www\./, '') : null;
  function visit(node: PageNode) {
    if (node.type === 'heading' && node.attrs?.level === 2) headings.push(nodeText(node));
    if (node.type === 'image') images++;
    if (hostname) {
      links += node.marks?.filter(mark => {
        const href = mark.attrs?.href;
        return mark.type === 'link' && href && /^https?:/i.test(href) && new URL(href).hostname.replace(/^www\./, '') === hostname;
      }).length ?? 0;
    }
    node.content?.forEach(visit);
  }
  visit(root);
  return { headings, links, images, words: wordCount(root) };
}

function pageUrl(domain: string | undefined, slug: string) {
  if (!domain) return null;
  const base = domain.replace(/\/+$/, '');
  const url = safeUrl(`${/^https?:\/\//i.test(base) ? base : `https://${base}`}/${slug}`);
  return url && /^https?:/i.test(url) ? url : null;
}

export function StaffItemPreview({ data, item, version, position, draft, canEdit, edit, editNote, refresh, status, titleRef, itemMenu }: {
  data: StaffReviewData;
  item: StaffReviewItem;
  version: ReviewVersion;
  position: number;
  draft: boolean;
  canEdit: boolean;
  edit: (event?: HTMLElement) => void;
  editNote: (trigger: HTMLElement) => void;
  refresh: () => void;
  status: ReactNode;
  titleRef: Ref<HTMLHeadingElement>;
  itemMenu: ReactNode;
}) {
  const [full, setFull] = useState(false);
  const [enlarge, setEnlarge] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const photoTrigger = useRef<HTMLButtonElement>(null);
  const [loadedPhoto, setLoadedPhoto] = useState<{ src: string; width: number; height: number } | null>(null);
  const payload = version.payload;
  const client = data.request.clients;
  const type = itemTypeName(item, version);
  const title = payload.title || 'Untitled item';
  const isPage = item.item_type === 'page' && 'pageKind' in payload;
  const isGbp = item.item_type === 'gbp_post' && 'postType' in payload;
  const photoPaths = isGbp ? versionPhotoPaths(version.photo_paths, version.photo_path) : [];
  const photo = data.photos[isGbp ? photoPaths[photoIndex] : version.photo_path ?? ''] ?? null;
  const photoUnavailable = !photo || failedPhoto === photo;
  const readPhotoDimensions = useCallback((image: HTMLImageElement | null) => {
    if (photo && image?.naturalWidth && image.naturalHeight) {
      setLoadedPhoto({ src: photo, width: image.naturalWidth, height: image.naturalHeight });
    }
  }, [photo]);
  const dimensions = photo && loadedPhoto?.src === photo ? loadedPhoto : null;
  const photoName = photoPaths.length > 1 ? `photo ${photoIndex + 1} of ${photoPaths.length}` : 'photo';
  let preview: ReactNode;
  let detail: ReactNode;
  let extra: ReactNode;
  let url: string | null = null;
  let editLabel = 'Edit item';

  if (isGbp) {
    editLabel = 'Edit post';
    const range = offerRange(payload);
    const body = payload.body ?? '';
    const cta = payload.ctaLabel ?? '';
    const planned = weekday(payload.scheduledDate);
    const stepPhoto = (delta: number) => setPhotoIndex(index => (index + delta + photoPaths.length) % photoPaths.length);
    const photoPreview = !photoUnavailable ? <button type="button" className="ar-google-photo" ref={photoTrigger} onClick={() => setEnlarge(true)}
      aria-label={`Enlarge ${photoName} for item ${position}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- The source can be a signed or local fixture URL. */}
      <img key={photo} src={photo} alt="" referrerPolicy="no-referrer" ref={readPhotoDimensions}
        onLoad={event => readPhotoDimensions(event.currentTarget)} onError={() => setFailedPhoto(photo)} />
    </button> : <div className={`ar-google-placeholder${photoPaths.length ? ' ar-google-unavailable' : ''}`}>
      <ImageIcon size={20} aria-hidden />
      <strong>{photoPaths.length ? 'Photo unavailable' : 'Photo needed'}</strong>
      {photo && <a className="ar-button ar-compact" href={photo} target="_blank" rel="noopener noreferrer">Open photo</a>}
      {!photoPaths.length && canEdit && draft && <button type="button" className="ar-button ar-compact" onClick={event => edit(event.currentTarget)}>Add photo</button>}
    </div>;
    const photoNavigation = photoPaths.length > 1 && <div className="ar-google-photo-nav" role="group" aria-label="Preview photos" onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      stepPhoto(event.key === 'ArrowRight' ? 1 : -1);
    }}>
      <button type="button" aria-label="Previous photo" onClick={() => stepPhoto(-1)}><ChevronLeft size={18} aria-hidden /></button>
      <span aria-live="polite">{photoIndex + 1} / {photoPaths.length}</span>
      <button type="button" aria-label="Next photo" onClick={() => stepPhoto(1)}><ChevronRight size={18} aria-hidden /></button>
    </div>;
    const picker = photoPaths.length > 1 && <div className="ar-google-photo-picker" role="group" aria-label="Post photos">
        {photoPaths.map((path, index) => <button type="button" key={index} className="ar-google-thumb"
          aria-label={`Show photo ${index + 1} of ${photoPaths.length}`} aria-pressed={index === photoIndex}
          onClick={() => setPhotoIndex(index)} onKeyDown={event => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const delta = event.key === 'ArrowRight' ? 1 : -1;
            const next = (index + delta + photoPaths.length) % photoPaths.length;
            setPhotoIndex(next);
            event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
          }}>
          {data.photos[path] ? (
            // eslint-disable-next-line @next/next/no-img-element -- The source can be a signed or local fixture URL.
            <img src={data.photos[path]} alt="" referrerPolicy="no-referrer" />
          ) : <ImageIcon size={16} aria-hidden />}
          <span>{index + 1}</span>
        </button>)}
    </div>;
    preview = <>
      <GbpPostPreview clientName={client?.name ?? 'Client'} logoSrc={client?.logo_url ?? undefined}
        post={{ ...payload, position, scheduled: payload.scheduledDate, photo, status: item.status }}
        staff={{ photo: <div className="ar-google-gallery">{photoPreview}{photoNavigation}</div> }} />
      <Meter length={characterCount(body)} limit={gbpCharacterLimit} />
    </>;
    detail = <Facts rows={[
      ['Content type', <>{type} · <span className="ar-capitalize">{payload.postType}</span></>],
      ['Planned', planned ? `${planned}, ${payload.scheduledDate.slice(0, 4)}` : '—'],
      ...(range ? [['Offer runs', range] as [string, ReactNode]] : []),
      ['Button', cta ? (isPhoneCta(cta) ? `${cta} (business phone)` : cta) : '—'],
      ['Photo', <>
        {!photoPaths.length ? 'Photo needed' : photoUnavailable ? 'Preview unavailable' :
          <span className="ar-positive"><Check size={14} aria-hidden />{dimensions ? `${dimensions.width} × ${dimensions.height}${dimensions.width * 3 === dimensions.height * 4 ? ', 4:3' : ''}` : 'Included'}</span>}
        {picker}
      </>],
      ['Terms', payload.terms ? <span className="ar-positive"><Check size={14} aria-hidden />Included</span> : '—'],
      ['Version', `v${version.version_no}${!draft ? ' · Client preview' : version.version_no === 1 && data.botName ? ` · written by ${data.botName}` : ''}`],
    ]} />;
    extra = <section className="ar-full-copy">
      <h3>Full post text</h3>
      <p className={full ? '' : 'ar-clamp-copy'}>{body}</p>
      {full && payload.terms && <><h3 className="mt-3">Offer terms</h3><p>{payload.terms}</p></>}
      {full && !isPhoneCta(cta) && /^https:\/\//i.test(payload.ctaUrl ?? '') && <a className="ar-button ar-text-button" href={payload.ctaUrl} target="_blank" rel="noreferrer">Open button URL <ExternalLink size={14} aria-hidden /></a>}
    </section>;
  } else if (isPage) {
    const blog = payload.pageKind === 'blog';
    const doc = sanitizeDoc(payload.body);
    const facts = documentFacts(doc, client?.domain);
    const proposed = item.version ?? version;
    const baseline = item.releasedVersion && item.releasedVersion.id !== proposed.id ? item.releasedVersion :
      data.versions.find(entry => entry.item_id === item.id && entry.version_no === proposed.version_no - 1);
    const baselineOutline = baseline?.outline;
    const proposedOutline = proposed.outline;
    const changedSections = Array.isArray(baselineOutline) && Array.isArray(proposedOutline) ? [
      ...proposedOutline.filter(section => !baselineOutline.some(before => (before.sectionId === section.sectionId || before.slug === section.slug) && before.hash === section.hash)).map(section => section.title),
      ...baselineOutline.filter(section => !proposedOutline.some(after => after.sectionId === section.sectionId || after.slug === section.slug)).map(section => `${section.title} (removed)`),
    ] : null;
    const sections = changedSections ?? facts.headings;
    editLabel = blog ? 'Edit draft' : 'Edit page';
    url = pageUrl(client?.domain, payload.slug);
    preview = <PagePreview payload={payload} photoUrl={photo} images={data.photos} staffMode={blog ? 'blog' : 'page'} />;
    if (full && !blog && photo) preview = <>{preview}<PagePreview payload={payload} images={data.photos} staffMode="page" /></>;
    detail = <Facts rows={[
      ['Content type', type],
      ['URL', url ? <a className="ar-fact-link" href={url} target="_blank" rel="noreferrer">/{payload.slug}</a> : `/${payload.slug}`],
      ...(payload.plannedDate ? [['Planned', monthDay(payload.plannedDate)] as [string, ReactNode]] : []),
      ...(blog ? [
        ['Target keyword', payload.targetKeyword || 'Keyword needed'],
        ['Length', `${facts.words.toLocaleString('en-US')} words · ${Math.max(1, Math.ceil(facts.words / 220))} min read`],
        ['Internal links', facts.links],
        ['Images', facts.images],
      ] as [string, ReactNode][] : []),
      [changedSections && !blog ? 'Sections changed' : 'Sections', sections.length ? <ul>{sections.map((heading, index) => <li key={index}>{heading}</li>)}</ul> : '—'],
      ['Version', `v${version.version_no}${!draft ? ' · Client preview' : ''}`],
    ]} />;
    extra = <>
      <section className="ar-full-copy" aria-label="Search preview">
        <h3>Search preview</h3>
        <div className="ar-search-result">
          <small>{client?.domain ? `${client.domain} / ` : ''}{payload.slug}</small>
          <strong>{payload.metaTitle}</strong><p>{payload.metaDescription}</p>
        </div>
        <Meter length={characterCount(payload.metaTitle)} limit={60} unit="title" />
        <Meter length={characterCount(payload.metaDescription)} limit={160} unit="description" />
        {baseline?.payload && 'pageKind' in baseline.payload && 'pageKind' in proposed.payload &&
          <details><summary>{draft ? 'Previous and proposed search metadata' : 'Current and proposed search metadata'}</summary>
            <Facts rows={[[ draft ? 'Previous title' : 'Current title', baseline.payload.metaTitle ], [ 'Proposed title', proposed.payload.metaTitle ],
              [ draft ? 'Previous description' : 'Current description', baseline.payload.metaDescription ], [ 'Proposed description', proposed.payload.metaDescription ]]} />
          </details>}
      </section>
      {data.comments && <AgencyComments anchorOrder={(doc.content ?? []).map(block => String(block.attrs?.blockId))}
        requestId={data.request.id} comments={data.comments.filter(comment => comment.item_id === item.id)}
        currentImages={Object.fromEntries([
          ['mockup', photo],
          ...(doc.content ?? []).filter(block => block.type === 'image').map(block => [String(block.attrs?.blockId), data.photos[String(block.attrs?.src)] ?? String(block.attrs?.src)]),
        ])} canWrite={canEdit} refresh={refresh} />}
    </>;
  } else {
    preview = <div className="ar-card p-4">{typeof payload.body === 'string' ? <p className="whitespace-pre-wrap">{payload.body}</p> : <p>Preview unavailable for this item type.</p>}</div>;
    detail = <Facts rows={[[ 'Content type', type ], [ 'Version', `v${version.version_no}` ]]} />;
  }
  const clientComments = isGbp ? data.comments?.filter(comment =>
    comment.item_id === item.id && !comment.parent_id && comment.author_kind === 'client') ?? [] : [];
  const feedback = data.internalFeedback?.filter(entry => entry.itemId === item.id) ?? [];
  const review = item.staffReview;
  const ownNote = review?.reviewer_id === data.actorId;
  const showNote = draft && review?.decision === 'changes_requested' && review.version_id === item.current_version_id && review.note;
  return <>
    <div className={`ar-pane-body ${isPage && payload.pageKind === 'blog' ? 'ar-blog-body' : ''}`}>
      <div className="ar-preview-column">{preview}</div>
      <div className="ar-item-details">
        <div className="ar-mobile-status">{status}</div>
        <h2 id="ar-item-title" tabIndex={-1} ref={titleRef}>{title}</h2>
        {detail}
        {!draft && canEdit && item.version && <p className="ar-fine">Editing creates version {item.version.version_no + 1}.</p>}
        <div className="ar-item-tools">
          {draft && canEdit && item.version && <button className="ar-button ar-text-button" onClick={event => edit(event.currentTarget)}><Pencil size={16} aria-hidden />{editLabel}</button>}
          {url && <a className="ar-button ar-text-button" href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden />View page</a>}
          {(isGbp || isPage && Boolean(photo) && payload.pageKind !== 'blog') && <button className="ar-button ar-text-button" aria-expanded={full} onClick={() => setFull(!full)}>
            <Maximize2 size={16} aria-hidden />{full ? 'Show compact preview' : 'Open full item'}
          </button>}
          {itemMenu}
        </div>
        {showNote && <div className="ar-review-note">
          <p><strong>{ownNote ? 'Your note' : review.reviewer_name ?? 'Staff note'}:</strong> {review.note}</p>
          {!!review.tags.length && <p className="ar-capitalize">{review.tags.join(' · ')}</p>}
          {canEdit && <button className="ar-button ar-text-button" onClick={event => editNote(event.currentTarget)}>Edit<span className="sr-only"> review note</span></button>}
        </div>}
        {extra}
        {!!clientComments.length && <section className="ar-full-copy" aria-label="Client comments">
          <h3>Client comments</h3>
          <ul>{clientComments.map(comment => <li key={comment.id}>
            <p><strong>{comment.author_name}</strong>{comment.versionNo && ` · Version ${comment.versionNo}`}
              {comment.photo_position ? <FeedbackPhoto position={comment.photo_position} url={comment.photoUrl} /> : ' · Whole post'}</p>
            <p className="whitespace-pre-wrap">{comment.body}</p>
          </li>)}</ul>
        </section>}
        {!!feedback.length && <section className="ar-full-copy" aria-label="Internal feedback">
          <h3>Internal feedback</h3>
          <ul>{feedback.map(entry => <li key={entry.id}>
            <p><strong>{entry.reviewerName}</strong> · {feedbackLabel(entry.decision)}{entry.versionNo !== null && ` · Version ${entry.versionNo}`}<FeedbackPhoto position={entry.photoPosition} url={entry.photoUrl} /></p>
            {entry.comment && <p className="whitespace-pre-wrap">{entry.comment}</p>}
          </li>)}</ul>
        </section>}
        {item.response && <div className="ar-full-copy">
          <h3>Client response · {item.response.decision.replaceAll('_', ' ')}</h3>
          <p className="whitespace-pre-wrap">{item.response.comment}</p>
        </div>}
      </div>
    </div>
    {enlarge && photo && <ReviewDialog title={title} onClose={() => setEnlarge(false)} restoreFocus={() => photoTrigger.current} className="sm:max-w-4xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="max-h-[72dvh] w-full object-contain" src={photo} referrerPolicy="no-referrer" alt={`${photoName} for ${title}`} />
    </ReviewDialog>}
  </>;
}
