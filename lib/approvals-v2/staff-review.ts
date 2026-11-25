export const staffReviewTags = ['copy', 'photo', 'dates', 'cta', 'other'] as const;
export type StaffReviewTag = typeof staffReviewTags[number];
export type StaffDecision = 'approved' | 'changes_requested';
export type ReviewStatus = StaffDecision | 'pending';

export interface StaffReview {
  decision: StaffDecision;
  note: string | null;
  tags: StaffReviewTag[];
  reviewer_id: string | null;
  reviewer_name: string | null;
  created_at: string;
  version_id: string;
}

type ReviewableItem = {
  id: string;
  current_version_id: string | null;
  status: ReviewStatus;
  staffReview?: StaffReview | null;
};

export function reviewStatus(item: ReviewableItem, draft: boolean): ReviewStatus {
  if (!draft) return item.status;
  return item.staffReview?.version_id === item.current_version_id ? item.staffReview?.decision ?? 'pending' : 'pending';
}

export const reviewFilters = ['all', 'pending', 'changes_requested', 'approved'] as const;
export type ReviewFilter = typeof reviewFilters[number];

export function filterReviewItems<T extends ReviewableItem>(items: T[], filter: ReviewFilter, draft: boolean): T[] {
  return filter === 'all' ? items : items.filter(item => reviewStatus(item, draft) === filter);
}

export function reviewCounts(items: ReviewableItem[], draft: boolean) {
  const counts = { all: items.length, pending: 0, approved: 0, changes_requested: 0 };
  for (const item of items) counts[reviewStatus(item, draft)]++;
  return counts;
}

export function nextUnreviewed<T extends ReviewableItem>(items: T[], selectedId: string): T | undefined {
  const index = items.findIndex(item => item.id === selectedId);
  return [...items.slice(index + 1), ...items.slice(0, Math.max(0, index))]
    .find(item => reviewStatus(item, true) === 'pending');
}

export const gbpCharacterLimit = 1500;
export const reviewNoteLimit = 4000;
export const characterCount = (value: string) => Array.from(value).length;
export const isPhoneCta = (label: string) => /^call(?: now)?$/i.test(label.trim());

export type ReviewBlocker = { label: string; reason: string };
export function staffReviewBlockers(itemType: string, pageKind: string | null, payload: unknown, photoPaths: readonly string[], videoPath?: string | null): ReviewBlocker[] {
  if (!payload || typeof payload !== 'object') return [{ label: 'Preview unavailable', reason: 'This item has no current version.' }];
  const fields = payload as Record<string, unknown>;
  const get = (key: string) => typeof fields[key] === 'string' ? fields[key].trim() : '';
  const blockers: ReviewBlocker[] = [];
  if (itemType === 'gbp_post') {
    if (!photoPaths.length && !videoPath) blockers.push({ label: 'Photo needed', reason: 'Add a photo or video before approving.' });
    const length = typeof fields.body === 'string' ? characterCount(fields.body) : 0;
    if (length > gbpCharacterLimit) blockers.push({ label: 'Over character limit', reason: 'Shorten the post to 1,500 characters before approving.' });
    const label = get('ctaLabel');
    if (label && !isPhoneCta(label) && !get('ctaUrl')) blockers.push({ label: 'CTA URL needed', reason: 'Add a button URL before approving.' });
  }
  if (itemType === 'blog' || itemType === 'page' && (pageKind ?? fields.pageKind) === 'blog') {
    if (!get('title')) blockers.push({ label: 'Title needed', reason: 'Add a title before approving.' });
    if (!get('targetKeyword')) blockers.push({ label: 'Keyword needed', reason: 'Add a target keyword before approving.' });
  }
  return blockers;
}

type Shortcut = 'next' | 'previous' | 'first' | 'last' | 'approve' | 'changes' | 'edit' | 'help' | 'cancelNote' | 'submitNote';
export function reviewShortcut(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat' | 'defaultPrevented' | 'isComposing'>,
  context: { typing: boolean; inList: boolean; dialog: boolean; note: boolean; inNote?: boolean; singleKeysOff: boolean },
): Shortcut | undefined {
  if (event.defaultPrevented || event.isComposing || context.dialog) return;
  if (context.note) {
    if (event.key === 'Escape' && !event.repeat) return 'cancelNote';
    if (context.inNote && event.key === 'Enter' && !event.altKey && !event.shiftKey && (event.ctrlKey || event.metaKey) && !event.repeat) return 'submitNote';
    return;
  }
  if (context.typing || event.altKey || event.ctrlKey || event.metaKey) return;
  if (context.inList && !event.shiftKey) {
    if (event.key === 'ArrowDown') return 'next';
    if (event.key === 'ArrowUp') return 'previous';
    if (event.key === 'Home') return 'first';
    if (event.key === 'End') return 'last';
  }
  if (context.singleKeysOff) return;
  if (event.key === '?') return event.repeat ? undefined : 'help';
  if (event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key === 'j') return 'next';
  if (key === 'k') return 'previous';
  if (!event.repeat) {
    if (key === 'a') return 'approve';
    if (key === 'r') return 'changes';
    if (key === 'e') return 'edit';
  }
}
