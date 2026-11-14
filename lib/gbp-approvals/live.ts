import { createAdminClient } from '@/lib/supabase/admin';
import { hashToken } from '@/lib/approvals/token';

import { hashIp, projectPublicReview, type PublicReviewView } from './public-view';

const PEPPER = process.env.APPROVAL_IP_PEPPER || 'seo-ops-gbp-approval-ip';

export async function loadPublicReview(token: string, photoSrcFor?: (path: string) => Promise<string | null>, adminFactory = createAdminClient): Promise<PublicReviewView | { code: string } | null> {
    const admin = adminFactory();
    const { data, error } = await admin.rpc('get_gbp_approval_by_token', {
        p_token_hash: hashToken(token),
        p_now: new Date().toISOString(),
    });
    if (error || !data) return null;
    const paths = new Map<string, string>();
    const raw = data as { items?: Array<{ version?: { photoPath?: string; previous?: { photoPath?: string } }; decision?: { replacementPhotoPath?: string } }> };
    const found = new Set<string>();
    for (const item of raw.items ?? []) {
        const photo = item.version?.photoPath;
        const previous = item.version?.previous?.photoPath;
        if (photo) found.add(photo);
        if (previous) found.add(previous);
        if (item.decision?.replacementPhotoPath) found.add(item.decision.replacementPhotoPath);
    }
    for (const path of found) {
        if (path.startsWith('https://')) paths.set(path, path);
        else if (photoSrcFor && path.startsWith('gbp-approvals/')) {
            const signed = await photoSrcFor(path);
            if (signed) paths.set(path, signed);
        }
    }
    return projectPublicReview(data, path => paths.get(path) ?? (path.startsWith('https://') ? path : null));
}

export function clientIpHash(request: Request): string | null {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (!forwarded) return null;
    return hashIp(forwarded, PEPPER);
}

export async function signApprovalPhoto(path: string): Promise<string | null> {
    if (!path.startsWith('gbp-approvals/')) return path.startsWith('https://') ? path : null;
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from('gbp-approval-uploads').createSignedUrl(path, 60 * 10);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
}
