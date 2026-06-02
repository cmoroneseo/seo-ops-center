import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const orgId = searchParams.get('org') // present on invite links
    const next = searchParams.get('next') ?? '/dashboard'

    // Robustly derive origin for production environments
    const host = request.headers.get('x-forwarded-host') || new URL(request.url).host;
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const origin = `${protocol}://${host}`;

    if (code) {
        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        cookieStore.set({ name, value, ...options })
                    },
                    remove(name: string, options: CookieOptions) {
                        cookieStore.set({ name, value: '', ...options })
                    },
                },
            }
        )

        const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code)

        if (!error && sessionData?.user) {
            // If this is an invite link, auto-assign the user to the organization
            if (orgId) {
                try {
                    const admin = createAdminClient()
                    const userId = sessionData.user.id

                    // Check they aren't already a member
                    const { data: existing } = await admin
                        .from('organization_members')
                        .select('id')
                        .eq('organization_id', orgId)
                        .eq('user_id', userId)
                        .maybeSingle()

                    if (!existing) {
                        await admin.from('organization_members').insert({
                            organization_id: orgId,
                            user_id: userId,
                            role: 'member',
                        })
                    }
                } catch (err) {
                    console.error('Failed to assign org membership:', err)
                    // Don't block login if this fails — user can be added manually
                }
            }

            return NextResponse.redirect(`${origin}${next}`)
        }
    }

    // return the user to an error page with instructions
    return NextResponse.redirect(`${origin}/login?error=Could not authenticate user`)
}
