import { safeClientLogoUrl } from './client-logo';
import { createHash } from 'node:crypto';
import { carryAnchor, type CommentAnchor } from './carry';
import { cache } from 'react';
import { hashToken } from '@/lib/approvals/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { signApprovalPhoto } from '@/lib/gbp-approvals/live';
import { PUBLIC_REVIEW_HEADERS, projectPublicReview, publicReviewMediaPaths, publicStatus } from '@/lib/gbp-approvals/public-view';
import { uuid } from './list';
import { imagePaths } from './page-body';
import { sanitizeDoc } from './page-doc';
import type { PagePayload } from './registry';
import type { OutlineSection } from './page-body';
export interface PublicPageItem {
  id: string;
  position: number;
  status: 'pending' | 'approved' | 'changes_requested';
  locked: boolean;
  version: {
    id: string;
    versionNo: number;
    payload: PagePayload;
    outline: OutlineSection[];
    photoPath: string | null;
  };
  decision?: {
    decision: string;
    comment: string | null;
  } | null;
}
export interface PublicPageView {
  itemType: 'page';
  state: 'active' | 'expired' | 'revoked';
  clientName: string;
  title: string;
  expiresAt: string | null;
  sentAt?: string;
  domain?: string;
  items: PublicPageItem[];
  questions: {
    id: string;
    prompt: string;
    answer?: string | null;
  }[];
}

/** A caller may only sign assets under the request proved by its token or staff query. */
export async function signRequestAsset(requestId: string, path: string, signer = signApprovalPhoto) {
  if (path.startsWith('https://')) return signer(path);
  if (!uuid.test(requestId) || !['approval-assets', 'gbp-approvals'].some(prefix => path.startsWith(`${prefix}/${requestId}/`))) return null;
  return signer(path);
}
export async function loadApprovalReviewForToken(token: string,
  { createAdminClient: adminFactory, signApprovalPhoto: sign } = { createAdminClient, signApprovalPhoto }) {
  if (token.length < 20 || token.length > 500) return null;
  const admin = adminFactory();
  const {
    data,
    error
  } = await admin.rpc('get_approval_by_token', {
    p_token_hash: hashToken(token),
    p_now: new Date().toISOString()
  });
  if (error || !data || data.ok === false) return null;
  if (data.itemType === 'page') {
    const link = await admin.from('approval_links').select('request_id').eq('token_hash', hashToken(token)).maybeSingle();
    if (link.error || !link.data) return null;
    const request = await admin.from('approval_requests').select('sent_at,clients!approval_requests_client_id_fkey(domain)').eq('id', link.data.request_id).maybeSingle();
    const client = request.data?.clients as {
      domain?: string;
    } | null;
    return {
      ...data,
      sentAt: request.data?.sent_at ?? undefined,
      domain: client?.domain ?? undefined
    } as PublicPageView;
  }
  let clientLogoUrl = null;
  if (data.state === 'active') {
    const link = await admin.from('approval_links').select('request_id').eq('token_hash', hashToken(token)).maybeSingle();
    if (!link.error && link.data) {
      const request = await admin.from('approval_requests').select('clients!approval_requests_client_id_fkey(logo_url)').eq('id', link.data.request_id).maybeSingle();
      const client = request.data?.clients as { logo_url?: string } | null;
      if (!request.error) clientLogoUrl = safeClientLogoUrl(client?.logo_url);
    }
  }
  const paths = new Map(await Promise.all(publicReviewMediaPaths(data).map(async path =>
    [path, await sign(path)] as const)));
  return projectPublicReview({ ...data, clientLogoUrl }, path => paths.get(path) ?? null);
}
export const loadApprovalReview = cache(loadApprovalReviewForToken);
export function createPublicItem(dependencies = {
  createAdminClient,
  signApprovalPhoto
}) {
  return async function GET(_request: Request, context: {
    params: Promise<{
      token: string;
      itemId: string;
    }>;
  }) {
    const {
      token,
      itemId
    } = await context.params;
    const json = (body: unknown, status = 200) => Response.json(body, {
      status,
      headers: PUBLIC_REVIEW_HEADERS
    });
    if (!uuid.test(itemId) || token.length < 20 || token.length > 500) return json({
      error: 'Page not found.'
    }, 404);
    try {
      const admin = dependencies.createAdminClient();
      const {
        data,
        error
      } = await admin.rpc('get_approval_item_by_token', {
        p_token_hash: hashToken(token),
        p_item_id: itemId,
        p_now: new Date().toISOString()
      });
      if (data?.code === 'rate_limited') return json({
        error: 'Too many requests. Please try again shortly.'
      }, 429);
      if (data?.state === 'expired' || data?.state === 'revoked') return json({
        error: 'This review link is no longer available.'
      }, publicStatus(data.state));
      if (error || !data || data.ok === false || data.itemType !== 'page' || !data.version?.id) return json({
        error: 'Page not found.'
      }, 404);
      // Resolve request identity through this token, never through caller input.
      const link = await admin.from('approval_links').select('request_id').eq('token_hash', hashToken(token)).maybeSingle();
      if (link.error || !link.data) return json({
        error: 'Page not found.'
      }, 404);
      const requestId = link.data.request_id;
      const {
        targetKeyword: _internal,
        ...payload
      } = data.version.payload as PagePayload;
      void _internal;
      payload.body = {
        ...sanitizeDoc(payload.body)
      };
      const paths = [...new Set([...imagePaths(payload.body), data.version.photoPath].filter((path): path is string => typeof path === 'string'))];
      const images = Object.fromEntries(await Promise.all(paths.map(async path => {
        let preview = path;
        if (path.startsWith(`gbp-approvals/${requestId}/`)) {
          const upload = await admin.from('approval_upload_reservations').select('preview_key').eq('object_key', path).eq('request_id', requestId).maybeSingle();
          if (upload.data?.preview_key) preview = upload.data.preview_key;
        }
        return [path, await signRequestAsset(requestId, preview, dependencies.signApprovalPhoto)];
      })));
      const photoHash = data.version.photoPath ? createHash('sha256').update(data.version.photoPath).digest('hex') : undefined;
      const comments = await Promise.all((data.comments ?? []).filter((comment: { parent_id: string | null }) => !comment.parent_id).map(async (comment: Record<string, unknown>) => {
        const anchor: CommentAnchor = {
          anchorKind: comment.anchor_kind as CommentAnchor['anchorKind'],
          pinTarget: comment.pin_target as CommentAnchor['pinTarget'],
          sectionId: comment.section_id as string,
          blockId: comment.block_id as string,
          targetHash: comment.target_hash as string,
          rangeStart: comment.range_start as number,
          rangeEnd: comment.range_end as number,
          quote: comment.quote as string,
          quotePrefix: comment.quote_prefix as string,
          quoteSuffix: comment.quote_suffix as string
        };
        const source = await admin.from('approval_item_versions').select('version_no,outline').eq('id', comment.version_id).eq('item_id', itemId).maybeSingle();
        const carried = carryAnchor(anchor, sanitizeDoc(payload.body), data.version.outline, photoHash, source.data?.outline ?? []);
        const reply = (data.comments ?? []).filter((reply: { parent_id: unknown }) => reply.parent_id === comment.id).map((reply: { body: string }) => reply.body).join('\n');
        // Do not expose draft version numbers or draft payloads to clients.
        const resolution = comment.resolved_in_version_id ? await admin.from('approval_item_versions').select('version_no').eq('id', comment.resolved_in_version_id).eq('item_id', itemId).maybeSingle() : null;
        let suggestedImageUrl = null;
        if (typeof comment.suggested_image_key === 'string') {
          const upload = await admin.from('approval_upload_reservations').select('preview_key').eq('object_key', comment.suggested_image_key).eq('request_id', requestId).maybeSingle();
          if (upload.data?.preview_key) suggestedImageUrl = await signRequestAsset(requestId, upload.data.preview_key, dependencies.signApprovalPhoto);
        }
        return { id: comment.id, anchor: carried, state: carried.state, body: comment.body, addressed: !!comment.resolved_at, quote: comment.quote, versionNo: source.data?.version_no ?? 1, reply: reply || comment.suggestion_reply, addressedVersion: resolution?.data?.version_no <= data.version.versionNo ? resolution?.data?.version_no : null, suggestedImageUrl };
      }));
      return json({
        itemId,
        comments,
        photoHash,
        version: {
          id: data.version.id,
          versionNo: data.version.versionNo,
          payload,
          outline: data.version.outline
        },
        photoUrl: images[data.version.photoPath] ?? null,
        images
      });
    } catch {
      return json({
        error: 'Page not found.'
      }, 404);
    }
  };
}
