/** Only allow logos from this project's public client-logos bucket. Server-side only. */
export function safeClientLogoUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 1000) return null;
  try {
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    const parsed = new URL(url);
    const prefix = `${base.origin}/storage/v1/object/public/client-logos/`;
    if (!['https:', 'http:'].includes(base.protocol) || parsed.username || parsed.password) return null;
    return parsed.origin === base.origin && url.startsWith(prefix) && parsed.href.startsWith(prefix) ? url : null;
  } catch {
    return null;
  }
}
