'use client';

import { useEffect } from 'react';

import { useOrganization } from '@/components/providers/organization-provider';
import { DEFAULT_THEME, buildThemeCss } from '@/lib/theme/palette';

const STYLE_ID = 'brand-theme';
const CACHE_KEY = 'brandThemeCss';

/**
 * Inline, render-blocking script that paints the organization's brand colour
 * before React boots.
 *
 * The organization is only known client-side (localStorage.selectedOrgId), so
 * without this every load would flash the default brand for as long as the
 * Supabase round trip takes. The cached stylesheet is the previous resolved
 * theme, which is correct on every load after the first.
 */
export const brandThemeBootScript = `(function(){try{var c=localStorage.getItem(${JSON.stringify(
    CACHE_KEY,
)});if(!c)return;var s=document.createElement('style');s.id=${JSON.stringify(
    STYLE_ID,
)};s.textContent=c;document.head.appendChild(s);}catch(e){}})();`;

/** Write the resolved theme into the single brand stylesheet, creating it if needed. */
function applyThemeCss(css: string) {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.appendChild(style);
    }
    // Appended to <head> after the app stylesheet, so equal-specificity
    // :root / .dark declarations from globals.css lose to these.
    if (style.textContent !== css) style.textContent = css;
}

/**
 * Keeps the brand stylesheet in sync with the active organization.
 *
 * Imperative rather than a rendered <style> so the boot script and React write
 * to the same element — no duplicate blocks, and no hydration mismatch from a
 * value only the browser can know.
 */
export function BrandThemeSync() {
    const { organization, isLoading } = useOrganization();

    useEffect(() => {
        if (isLoading) return;

        const css = buildThemeCss(organization?.theme ?? DEFAULT_THEME);
        applyThemeCss(css);

        try {
            localStorage.setItem(CACHE_KEY, css);
        } catch {
            // Private mode or a full quota: the theme still applies this session.
        }
    }, [organization?.theme, isLoading]);

    return null;
}

/** Preview a theme immediately, without waiting for a save to round-trip. */
export function previewThemeCss(css: string) {
    applyThemeCss(css);
}
