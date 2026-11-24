import { createAdminClient } from '@/lib/supabase/admin';
import { hashToken } from '@/lib/approvals/token';

import { hashIp, projectPublicReview, publicReviewPhotoPaths, type PublicReviewView } from './public-view';

const PEPPER = process.env.APPROVAL_IP_PEPPER || 'seo-ops-gbp-approval-ip';

export async function loadPublicReview(token: string, photoSrcFor?: (path: string) => Promise<string | null>, adminFactory = createAdminClient): Promise<PublicReviewView | { code: string } | null> {
    const admin = adminFactory();
    const { data, error } = await admin.rpc('get_gbp_approval_by_token', {
        p_token_hash: hashToken(token),
        p_now: new Date().toISOString(),
    });
    if (error || !data) return null;
    const sources = new Map(await Promise.all(publicReviewPhotoPaths(data).map(async path => {
        if (path.startsWith('https://')) return [path, path] as const;
        const stored = path.startsWith('gbp-approvals/') || path.startsWith('approval-assets/');
        return [path, stored && photoSrcFor ? await photoSrcFor(path) : null] as const;
    })));
    return projectPublicReview(data, path => sources.get(path) ?? null);
}

export function clientIpHash(request: Request): string | null {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (!forwarded) return null;
    return hashIp(forwarded, PEPPER);
}

export async function signApprovalPhoto(path: string): Promise<string | null> {
    if (!path.startsWith('gbp-approvals/') && !path.startsWith('approval-assets/')) return path.startsWith('https://') ? path : null;
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from('gbp-approval-uploads').createSignedUrl(path, 60 * 10);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
}
