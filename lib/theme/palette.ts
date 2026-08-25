/**
 * Brand theming: one brand colour -> the derived set of design tokens.
 *
 * Only the brand-carrying tokens are themed. Semantic colours
 * (destructive, and the red/amber/blue/green status palette) stay fixed so an
 * error state never becomes indistinguishable from a brand accent, and charts
 * 2-5 stay fixed so series remain separable regardless of brand hue.
 */

import type { Oklch } from './color.ts';
import {
    contrastRatio,
    fitToGamut,
    formatOklch,
    hexToOklch,
    oklchToHex,
    oklchToRgb,
} from './color.ts';

export type ThemeMode = 'light' | 'dark';

export interface OrganizationTheme {
    /** Preset id, or 'custom' when `hex` carries the colour. */
    preset: string;
    /** Only meaningful when preset === 'custom'. */
    hex?: string;
}

export interface ThemePreset {
    id: string;
    label: string;
    primary: Oklch;
    accent: Oklch;
}

/**
 * Lightness bands. A brand colour is clamped into these so primary surfaces
 * stay legible against the near-white / near-black app backgrounds. Chroma is
 * capped to keep gamut fitting from silently desaturating the result.
 */
const BAND: Record<ThemeMode, { minL: number; maxL: number; maxC: number }> = {
    light: { minL: 0.45, maxL: 0.68, maxC: 0.3 },
    dark: { minL: 0.5, maxL: 0.8, maxC: 0.3 },
};

/** Candidate foregrounds, matching the neutrals already in globals.css. */
const FG_LIGHT: Oklch = { l: 0.985, c: 0, h: 0 };
const FG_DARK: Oklch = { l: 0.2, c: 0.02, h: 260 };

/**
 * Primary/accent surfaces carry large, semibold UI text (buttons, badges,
 * chart labels), so 3:1 is the applicable WCAG AA floor rather than 4.5:1.
 */
export const AA_LARGE = 3;
export const AA_NORMAL = 4.5;

/**
 * How much better ink has to be before overriding the light-text preference.
 * Brand colours are designed against light text, so a marginal win is not
 * worth inverting every button in the app; a decisive one is.
 */
const INK_OVERRIDE_MARGIN = 1.5;

/** Degrees of hue rotation used to derive an accent from a custom brand hue. */
const ACCENT_HUE_SHIFT = 28;

export const THEME_PRESETS: ThemePreset[] = [
    // Matches the shipped tokens exactly — selecting it is a no-op.
    { id: 'neon-pink', label: 'Neon Pink', primary: { l: 0.63, c: 0.26, h: 352 }, accent: { l: 0.7, c: 0.18, h: 20 } },
    { id: 'electric-blue', label: 'Electric Blue', primary: { l: 0.55, c: 0.2, h: 255 }, accent: { l: 0.7, c: 0.15, h: 210 } },
    { id: 'emerald', label: 'Emerald', primary: { l: 0.53, c: 0.16, h: 158 }, accent: { l: 0.7, c: 0.14, h: 190 } },
    { id: 'violet', label: 'Violet', primary: { l: 0.58, c: 0.24, h: 295 }, accent: { l: 0.68, c: 0.18, h: 330 } },
    { id: 'amber', label: 'Amber', primary: { l: 0.66, c: 0.17, h: 65 }, accent: { l: 0.68, c: 0.19, h: 35 } },
    { id: 'cyan', label: 'Cyan', primary: { l: 0.53, c: 0.14, h: 210 }, accent: { l: 0.7, c: 0.13, h: 180 } },
    { id: 'crimson', label: 'Crimson', primary: { l: 0.57, c: 0.22, h: 20 }, accent: { l: 0.68, c: 0.17, h: 350 } },
    { id: 'indigo', label: 'Indigo', primary: { l: 0.55, c: 0.19, h: 275 }, accent: { l: 0.67, c: 0.16, h: 300 } },
];

export const DEFAULT_THEME: OrganizationTheme = { preset: 'neon-pink' };

export function getPreset(id: string): ThemePreset | undefined {
    return THEME_PRESETS.find((p) => p.id === id);
}

/** Clamp a colour into the safe band for a mode, then fit it to sRGB. */
export function clampToBand(color: Oklch, mode: ThemeMode): Oklch {
    const { minL, maxL, maxC } = BAND[mode];
    return fitToGamut({
        l: Math.min(maxL, Math.max(minL, color.l)),
        c: Math.min(maxC, Math.max(0, color.c)),
        h: ((color.h % 360) + 360) % 360,
    });
}

/**
 * Pick the foreground that actually reads on this background.
 *
 * Light text is the default because that is what saturated brand colours are
 * designed against. Ink wins only when light text has already failed AA for
 * normal text and ink is decisively better — which is what rescues pale
 * brand colours (yellow, lime, pastel) from producing invisible buttons.
 */
export function readableForeground(background: Oklch): Oklch {
    const bg = oklchToRgb(background);
    const lightRatio = contrastRatio(bg, oklchToRgb(FG_LIGHT));
    const darkRatio = contrastRatio(bg, oklchToRgb(FG_DARK));

    if (lightRatio >= AA_NORMAL) return FG_LIGHT;
    if (darkRatio - lightRatio >= INK_OVERRIDE_MARGIN) return FG_DARK;
    if (lightRatio >= AA_LARGE) return FG_LIGHT;
    return lightRatio >= darkRatio ? FG_LIGHT : FG_DARK;
}

/** Measured contrast between a themed surface and the foreground it will use. */
export function surfaceContrast(surface: Oklch): number {
    return contrastRatio(oklchToRgb(surface), oklchToRgb(readableForeground(surface)));
}

/** Resolve a stored theme to its base primary/accent, before per-mode clamping. */
export function resolveBaseColors(theme: OrganizationTheme): { primary: Oklch; accent: Oklch } {
    if (theme.preset !== 'custom') {
        const preset = getPreset(theme.preset) ?? getPreset(DEFAULT_THEME.preset)!;
        return { primary: preset.primary, accent: preset.accent };
    }

    const parsed = theme.hex ? hexToOklch(theme.hex) : null;
    if (!parsed) {
        const fallback = getPreset(DEFAULT_THEME.preset)!;
        return { primary: fallback.primary, accent: fallback.accent };
    }

    return {
        primary: parsed,
        accent: {
            l: parsed.l,
            // Accents read better slightly softer than the primary they sit beside.
            c: parsed.c * 0.72,
            h: parsed.h + ACCENT_HUE_SHIFT,
        },
    };
}

/** The themed CSS custom properties for one mode. */
export function buildTokens(theme: OrganizationTheme, mode: ThemeMode): Record<string, string> {
    const base = resolveBaseColors(theme);
    const primary = clampToBand(base.primary, mode);
    const accent = clampToBand(base.accent, mode);
    const primaryFg = readableForeground(primary);
    const accentFg = readableForeground(accent);

    const primaryCss = formatOklch(primary);
    const accentCss = formatOklch(accent);

    return {
        '--primary': primaryCss,
        '--primary-foreground': formatOklch(primaryFg),
        '--ring': primaryCss,
        '--accent': accentCss,
        '--accent-foreground': formatOklch(accentFg),
        '--chart-1': primaryCss,
        '--chart-2': accentCss,
        '--sidebar-primary': primaryCss,
        '--sidebar-primary-foreground': formatOklch(primaryFg),
        '--sidebar-ring': primaryCss,
    };
}

const declarations = (tokens: Record<string, string>) =>
    Object.entries(tokens)
        .map(([name, value]) => `${name}:${value};`)
        .join('');

/**
 * The full stylesheet for a theme. Scoped so the dark block wins inside
 * `.dark` exactly the way globals.css orders them.
 */
export function buildThemeCss(theme: OrganizationTheme): string {
    return (
        `:root{${declarations(buildTokens(theme, 'light'))}}` +
        `.dark{${declarations(buildTokens(theme, 'dark'))}}`
    );
}

/** Swatch colours for the theme picker (dark mode, where the app lives). */
export function previewHex(theme: OrganizationTheme): string {
    return oklchToHex(clampToBand(resolveBaseColors(theme).primary, 'dark'));
}

export function previewAccentHex(theme: OrganizationTheme): string {
    return oklchToHex(clampToBand(resolveBaseColors(theme).accent, 'dark'));
}

/** Narrow unknown jsonb from the database into a usable theme. */
export function parseTheme(value: unknown): OrganizationTheme {
    if (!value || typeof value !== 'object') return DEFAULT_THEME;
    const raw = value as Record<string, unknown>;
    const preset = typeof raw.preset === 'string' ? raw.preset : null;
    if (!preset) return DEFAULT_THEME;
    if (preset === 'custom') {
        const hex = typeof raw.hex === 'string' && hexToOklch(raw.hex) ? raw.hex : null;
        return hex ? { preset: 'custom', hex } : DEFAULT_THEME;
    }
    return getPreset(preset) ? { preset } : DEFAULT_THEME;
}

export type ContrastLevel = 'AA' | 'AA Large' | 'Fail';

export interface ContrastReport {
    ratio: number;
    level: ContrastLevel;
    /** True when the surface will carry light text. */
    lightText: boolean;
}

/**
 * What the picker shows the user. Surfacing the measured ratio is the point:
 * a custom brand colour that only reaches 3.2:1 should be a visible tradeoff,
 * not a silent one.
 */
export function themeContrast(theme: OrganizationTheme, mode: ThemeMode = 'dark'): ContrastReport {
    const primary = clampToBand(resolveBaseColors(theme).primary, mode);
    const ratio = surfaceContrast(primary);
    return {
        ratio,
        level: ratio >= AA_NORMAL ? 'AA' : ratio >= AA_LARGE ? 'AA Large' : 'Fail',
        lightText: readableForeground(primary).l > 0.5,
    };
}
