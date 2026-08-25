'use client';

import { useEffect } from 'react';

import { useOrganization } from '@/components/providers/organization-provider';
import { DEFAULT_THEME, buildThemeCss } from '@/lib/theme/palette';

const STYLE_ID = 'brand-theme';

/**
 * Write the resolved theme into the single brand stylesheet.
 *
 * On dashboard routes the element already exists, server-rendered by
 * BrandThemeStyle, and this only mutates it. On public routes there is nothing
 * to brand, so the element is created lazily and appended to <head> — after the
 * app stylesheet, so equal-specificity :root / .dark declarations lose to it.
 */
function applyThemeCss(css: string) {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
}

/**
 * Keeps the brand stylesheet in sync with the active organization.
 *
 * The first paint is already correct via SSR, so this exists for changes that
 * happen after load: switching organizations, and the Appearance tab preview.
 */
export function BrandThemeSync() {
    const { organization, isLoading } = useOrganization();

    useEffect(() => {
        if (isLoading) return;
        applyThemeCss(buildThemeCss(organization?.theme ?? DEFAULT_THEME));
    }, [organization?.theme, isLoading]);

    return null;
}

/** Preview a theme immediately, without waiting for a save to round-trip. */
export function previewThemeCss(css: string) {
    applyThemeCss(css);
}
