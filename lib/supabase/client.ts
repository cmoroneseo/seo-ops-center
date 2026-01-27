import { createBrowserClient } from '@supabase/ssr'

let supabaseInstance: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const isMock = !supabaseUrl || !supabaseKey ||
        supabaseUrl.includes('your_supabase') ||
        supabaseKey.includes('your_supabase')

    if (isMock) {
        if (typeof window !== 'undefined') {
            console.warn('Running in Mock Mode: Supabase environment variables are missing or placeholders.')
        }
        return undefined
    }

    if (!supabaseInstance) {
        supabaseInstance = createBrowserClient(
            supabaseUrl,
            supabaseKey
        )
    }

    return supabaseInstance
}
