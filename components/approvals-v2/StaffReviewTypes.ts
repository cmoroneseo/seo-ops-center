import type { GbpPostPayload } from '@/lib/gbp-approvals/registry';
import type { OutlineSection } from '@/lib/approvals-v2/page-body';
import type { PagePayload } from '@/lib/approvals-v2/registry';
import type { ReviewStatus, StaffDecision, StaffReview, StaffReviewTag } from '@/lib/approvals-v2/staff-review';
import type { StaffInternalFeedback } from '@/lib/internal-review/model';
import type { AgencyComment } from './AgencyComments';

export interface ReviewVersion {
  id: string;
  item_id: string;
  version_no: number;
  payload: GbpPostPayload | PagePayload;
  photo_path: string | null;
  outline?: OutlineSection[] | null;
  change_note: string | null;
  created_at: string;
}

export interface StaffReviewItem {
  id: string;
  position: number;
  item_type: string;
  page_kind: string | null;
  status: ReviewStatus;
  current_version_id: string | null;
  released_version_id: string | null;
  decision_lock_reason: string | null;
  version: ReviewVersion | null;
  releasedVersion: ReviewVersion | null;
  staffReview?: StaffReview | null;
  response: {
    id: string;
    item_id: string;
    comment: string | null;
    suggested_title: string | null;
    suggested_body: string | null;
    replacement_photo_path: string | null;
    created_at: string;
    decision: string;
  } | null;
}

export interface StaffReviewData {
  request: {
    id: string;
    title: string;
    stage: string;
    archived_at: string | null;
    due_at: string | null;
    created_via: string;
    created_at: string;
    clients: { name: string; domain?: string; logo_url?: string | null } | null;
    item_type: string;
  };
  items: StaffReviewItem[];
  comments?: AgencyComment[];
  internalFeedback?: (StaffInternalFeedback & { itemId: string })[];
  internalFeedbackUnavailable?: boolean;
  staffReviewUnavailable?: boolean;
  staffReviewHistory?: (StaffReview & { id: number; item_id: string })[];
  versions: ReviewVersion[];
  questions: { id: string; prompt: string }[];
  events: { id: string; kind: string; created_at: string }[];
  photos: Record<string, string | null>;
  link: { state: string; expiresAt: string; openedAt: string | null; revokedAt: string | null } | null;
  owner: { id: string; full_name: string } | null;
  botName: string | null;
  canSend: boolean;
  canWrite: boolean;
  sendReason: string | null;
  actorId?: string;
}

export type ReviewAction = (path: string, body?: unknown, method?: string) => Promise<boolean>;
export type SaveStaffReview = (input: {
  itemId: string;
  versionId: string;
  decision: StaffDecision;
  note?: string;
  tags?: StaffReviewTag[];
}) => Promise<void>;

export function displayVersion(item: StaffReviewItem, draft: boolean) {
  const version = (draft ? item.version : item.releasedVersion) ?? item.version;
  return version?.payload && typeof version.payload === 'object' ? version : null;
}

export function itemTypeName(item: StaffReviewItem, version: ReviewVersion | null) {
  if (item.item_type === 'gbp_post') return 'GBP post';
  const kind = version?.payload && typeof version.payload === 'object' && 'pageKind' in version.payload ? version.payload.pageKind : item.page_kind;
  if (kind === 'blog') return 'Blog draft';
  if (kind === 'service') return 'Service page';
  if (kind === 'city') return 'City page';
  return 'Page';
}
