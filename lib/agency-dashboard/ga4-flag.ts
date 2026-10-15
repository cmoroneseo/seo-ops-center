/**
 * GA4 numbers on the agency client cards. Off unless the flag is the exact
 * string `true`. An unset flag leaves the Search Console cards unchanged.
 */

export function ga4CardsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.NEXT_PUBLIC_GA4_CARDS === 'true';
}
