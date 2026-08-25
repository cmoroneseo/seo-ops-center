import { createHash, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { Resend } from 'resend';
import { createInvitePost } from '@/lib/security/invite-route';
import { requireOrganizationAdmin } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { teamInviteEmail } from '@/lib/email/templates';
import { parseTheme } from '@/lib/theme/palette';

export async function POST(req: NextRequest) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://seo-ops-center.vercel.app';

    return createInvitePost({
        authorizeInviter: requireOrganizationAdmin,
        randomToken: () => randomBytes(32).toString('base64url'),
        hashToken: (token) => createHash('sha256').update(token).digest('hex'),
        async createInvite(input) {
            const { error } = await createAdminClient().from('organization_invites').insert({
                token_hash: input.tokenHash,
                organization_id: input.organizationId,
                email: input.email,
                role: input.role,
                invited_by: input.invitedBy,
                expires_at: input.expiresAt,
            });
            if (error) throw error;
        },
        async revokeInvite(tokenHash) {
            await createAdminClient()
                .from('organization_invites')
                .delete()
                .eq('token_hash', tokenHash);
        },
        async generateAuthLink(email, redirectTo) {
            const { data, error } = await createAdminClient().auth.admin.generateLink({
                type: 'invite',
                email,
                options: { redirectTo },
            });
            if (error) throw error;
            return data?.properties?.action_link ?? null;
        },
        async sendInviteEmail(input) {
            // Brand the invite with the inviting organization's theme. A failed
            // lookup falls back to the default rather than blocking the invite.
            const { data: org } = await createAdminClient()
                .from('organizations')
                .select('theme')
                .eq('id', input.organizationId)
                .maybeSingle();

            const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
                from: 'SEO Ops Command Center <onboarding@resend.dev>',
                to: input.to,
                subject: `You're invited to join ${input.organizationName} on SEO Ops`,
                html: teamInviteEmail({
                    inviteUrl: input.inviteUrl,
                    organizationName: input.organizationName,
                    invitedByName: input.invitedByName,
                    theme: parseTheme(org?.theme),
                }),
            });
            if (error) throw error;
        },
        siteUrl,
        now: () => new Date(),
    })(req);
}
