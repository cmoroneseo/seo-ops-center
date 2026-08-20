import { createHash } from 'node:crypto';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAuthCallbackGet } from '@/lib/security/auth-callback';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) {
                    cookieStore.set({ name, value, ...options });
                },
                remove(name: string, options: CookieOptions) {
                    cookieStore.set({ name, value: '', ...options });
                },
            },
        },
    );
    const appOrigin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;

    return createAuthCallbackGet({
        async exchangeCode(code) {
            const { data, error } = await supabase.auth.exchangeCodeForSession(code);
            const email = data?.user?.email;
            return error || !data?.user?.id || !email
                ? null
                : { id: data.user.id, email };
        },
        async consumeInvite(token, user) {
            const tokenHash = createHash('sha256').update(token).digest('hex');
            const { data, error } = await createAdminClient().rpc('consume_organization_invite', {
                p_token_hash: tokenHash,
                p_user_id: user.id,
                p_email: user.email.toLowerCase(),
            });
            return !error && data === true;
        },
        appOrigin,
    })(request);
}
