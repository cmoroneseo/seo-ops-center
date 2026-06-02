import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/admin';
import { teamInviteEmail } from '@/lib/email/templates';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
    try {
        const { email, organizationName, invitedByName } = await req.json();

        if (!email || !organizationName) {
            return NextResponse.json({ error: 'Email and organization name are required' }, { status: 400 });
        }

        const supabase = createAdminClient();

        // Generate invite link without sending Supabase's default email
        const { data, error } = await supabase.auth.admin.generateLink({
            type: 'invite',
            email,
            options: {
                redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://seo-ops-center.vercel.app'}/auth/callback`,
            },
        });

        if (error) {
            console.error('Supabase generateLink error:', error);
            return NextResponse.json({ error: error.message }, { status: 400 });
        }

        const inviteUrl = data?.properties?.action_link;

        if (!inviteUrl) {
            return NextResponse.json({ error: 'Failed to generate invite link' }, { status: 500 });
        }

        // Send branded email via Resend
        const { error: emailError } = await resend.emails.send({
            from: 'SEO Ops Command Center <onboarding@resend.dev>',
            to: email,
            subject: `You're invited to join ${organizationName} on SEO Ops`,
            html: teamInviteEmail({ inviteUrl, organizationName, invitedByName }),
        });

        if (emailError) {
            console.error('Resend error:', emailError);
            return NextResponse.json({ error: 'Failed to send invitation email' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('Invite API error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
