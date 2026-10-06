import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { classifyActor, clientPortalAllowedPath, contactErrorKind, isPortalLoginPath } from '@/lib/portal/access-policy'

export async function middleware(request: NextRequest) {
    // The metrics handler validates the cron secret or client-scoped session itself.
    if (request.nextUrl.pathname === '/api/sync/metrics') return NextResponse.next();

    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const isMock = !supabaseUrl || !supabaseKey ||
        supabaseUrl.includes('your_supabase') ||
        supabaseKey.includes('your_supabase')

    // Mock Mode is only safe for local development without connected Supabase.
    if (isMock) {
        if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
            return new NextResponse('Supabase environment is not configured', { status: 500 })
        }
        return NextResponse.next({
            request: {
                headers: request.headers,
            },
        })
    }

    const supabase = createServerClient(
        supabaseUrl,
        supabaseKey,
        {
            cookies: {
                get(name: string) {
                    return request.cookies.get(name)?.value
                },
                set(name: string, value: string, options: CookieOptions) {
                    request.cookies.set({
                        name,
                        value,
                        ...options,
                    })
                    response = NextResponse.next({
                        request: {
                            headers: request.headers,
                        },
                    })
                    response.cookies.set({
                        name,
                        value,
                        ...options,
                    })
                },
                remove(name: string, options: CookieOptions) {
                    request.cookies.set({
                        name,
                        value: '',
                        ...options,
                    })
                    response = NextResponse.next({
                        request: {
                            headers: request.headers,
                        },
                    })
                    response.cookies.set({
                        name,
                        value: '',
                        ...options,
                    })
                },
            },
        }
    )

    const { data: { user } } = await supabase.auth.getUser()
    const { pathname } = request.nextUrl

    // Public routes that anyone can access
    const isPublicRoute = pathname === '/' ||
        pathname === '/login' ||
        pathname === '/signup' ||
        pathname.startsWith('/tools') ||
        pathname.startsWith('/vs')

    // Client content-approval portal. Authorization is the share token itself, verified
    // server-side against a stored sha-256 hash — clients have no account here, so any
    // session check would lock out exactly the people the link is for.
    const isReviewPortal = pathname.startsWith('/review') || pathname.startsWith('/api/portal')

    // API routes that authenticate via secret/token, not session cookies
    const isWebhookRoute = pathname.startsWith('/api/integrations/basecamp/webhook') ||
        pathname.startsWith('/api/cron/')

    // Portal sign-in is invite + magic link. The hub itself still requires a session.
    const isPortalEntry = isPortalLoginPath(pathname)

    // If user is not signed in and tries to access a protected route, redirect to /login
    if (!user && !isPublicRoute && !isReviewPortal && !isWebhookRoute && !isPortalEntry && !pathname.startsWith('/auth')) {
        if (pathname.startsWith('/api/client-portal/')) {
            const unauthorized = NextResponse.json({ error: 'Your sign-in has expired. Sign in again to continue.' }, { status: 401 })
            response.cookies.getAll().forEach(cookie => unauthorized.cookies.set(cookie))
            return unauthorized
        }
        if (pathname === '/portal' || pathname.startsWith('/portal/')) {
            const login = new URL('/portal/login', request.url)
            login.searchParams.set('next', pathname)
            return NextResponse.redirect(login)
        }
        return NextResponse.redirect(new URL('/login', request.url))
    }

    // Client contacts are not organization members. Keep them off staff pages and
    // staff APIs, which authorize "any signed-in user" in a few places.
    if (user && !isReviewPortal && !pathname.startsWith('/auth')) {
        const [memberships, contacts] = await Promise.all([
            supabase.from('organization_members').select('organization_id').limit(1),
            supabase.from('client_portal_contacts').select('id').eq('user_id', user.id).is('revoked_at', null).limit(1),
        ])
        const kind = classifyActor({
            membershipError: Boolean(memberships.error),
            membershipCount: memberships.data?.length ?? 0,
            contactError: contactErrorKind(contacts.error),
            contactCount: contacts.data?.length ?? 0,
        })
        const withSessionCookies = (next: NextResponse) => {
            response.cookies.getAll().forEach(cookie => next.cookies.set(cookie))
            return next
        }
        if (kind === 'client') {
            if (pathname === '/portal/login') {
                return withSessionCookies(NextResponse.redirect(new URL('/portal', request.url)))
            }
            if (!clientPortalAllowedPath(pathname)) {
                if (pathname.startsWith('/api/')) {
                    return withSessionCookies(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
                }
                return withSessionCookies(NextResponse.redirect(new URL('/portal', request.url)))
            }
            return response
        }
    }

    // If user is signed in and tries to access /login, /signup, or / (landing)
    // Redirect them to /dashboard
    if (user && isPublicRoute) {
        const redirect = NextResponse.redirect(new URL('/dashboard', request.url))
        response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
        return redirect
    }

    return response
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * Feel free to modify this pattern to include more paths.
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
