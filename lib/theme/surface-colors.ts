/**
 * Organic vs map-pack colors on reporting surfaces.
 *
 * Organic reads `--chart-1` (the brand primary). Map pack is the fixed
 * `--reporting-map` blue. When those two are too close, organic switches to
 * the default pink for the series only — the rest of the org theme stays put.
 *
 * Indigo's primary sits exactly 40° from map hue 235, and its OKLab distance
 * is still above 0.12. The hue check is therefore `<= 40°` so Electric Blue,
 * Cyan, and Indigo all fall back, which is the acceptance bar for this guard.
 */

import type { Oklch } from './color.ts';
import { formatOklch } from './color.ts';
import { ORGANIC_SERIES_TOKEN, type ThemeMode } from './palette.ts';

export const OKLAB_DELTA_E_LIMIT = 0.12;
export const HUE_GAP_LIMIT_DEG = 40;

/** Light map is the same hue as the specified dark blue, darkened so it reads on white. */
export const REPORTING_MAP_CSS: Record<ThemeMode, string> = {
    light: 'oklch(0.48 0.13 235)',
    dark: 'oklch(0.72 0.13 235)',
};

export const REPORTING_INFO_CSS: Record<ThemeMode, string> = {
    light: 'oklch(0.50 0.03 260)',
    dark: 'oklch(0.74 0.03 260)',
};

export const REPORTING_ORG_FALLBACK_CSS = 'oklch(0.63 0.26 352)';

export const ORGANIC_FALLBACK_NOTE =
    'Organic search color: pink (your theme is too close to map-pack blue)';

export const ORGANIC_BRAND_NOTE = 'Organic search color matches your brand.';

export interface SurfaceColors {
    organic: string;
    map: string;
    info: string;
    orgFallback: string;
    usesFallback: boolean;
    /** Which closeness check fired. Null when organic stays on `--chart-1`. */
    reason: 'hue' | 'oklab' | null;
    hueGap: number;
    deltaE: number;
}

const CHROMA_FOR_HUE = 0.02;

export function parseOklch(value: string): Oklch | null {
    const match = value.trim().match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)$/i);
    if (!match) return null;
    const l = Number(match[1]);
    const c = Number(match[2]);
    const h = Number(match[3]);
    if (![l, c, h].every(Number.isFinite)) return null;
    return { l, c, h };
}

export function hueGap(a: number, b: number): number {
    const raw = Math.abs(a - b) % 360;
    return raw > 180 ? 360 - raw : raw;
}

/** Euclidean distance in OKLab. OKLCH is converted at the given lightness. */
export function oklabDeltaE(a: Oklch, b: Oklch): number {
    const toLab = ({ l, c, h }: Oklch) => {
        const rad = (h * Math.PI) / 180;
        return { L: l, a: c * Math.cos(rad), b: c * Math.sin(rad) };
    };
    const left = toLab(a);
    const right = toLab(b);
    return Math.hypot(left.L - right.L, left.a - right.a, left.b - right.b);
}

function tokenColor(tokens: Record<string, string>, names: string[], fallback: string): string {
    for (const name of names) {
        const value = tokens[name];
        if (value && parseOklch(value)) return value.trim();
    }
    return fallback;
}

export function resolveSurfaceColors(tokens: Record<string, string>, mode: ThemeMode = 'dark'): SurfaceColors {
    const map = tokenColor(tokens, ['--reporting-map', '--map'], REPORTING_MAP_CSS[mode]);
    const info = tokenColor(tokens, ['--reporting-info', '--info'], REPORTING_INFO_CSS[mode]);
    const orgFallback = tokenColor(
        tokens,
        ['--reporting-org-fallback', '--org-fallback'],
        REPORTING_ORG_FALLBACK_CSS,
    );
    const chart1 = tokens[ORGANIC_SERIES_TOKEN] ?? tokens['--chart-1'] ?? '';
    const organicSource = parseOklch(chart1);
    const mapColor = parseOklch(map);
    const fallbackColor = parseOklch(orgFallback);

    if (!organicSource || !mapColor || !fallbackColor) {
        return {
            organic: orgFallback,
            map,
            info,
            orgFallback,
            usesFallback: true,
            reason: 'oklab',
            hueGap: 360,
            deltaE: 1,
        };
    }

    const gap = hueGap(organicSource.h, mapColor.h);
    const deltaE = oklabDeltaE(organicSource, mapColor);
    const hueTooClose = organicSource.c >= CHROMA_FOR_HUE && mapColor.c >= CHROMA_FOR_HUE && gap <= HUE_GAP_LIMIT_DEG;
    const labTooClose = deltaE < OKLAB_DELTA_E_LIMIT;
    const usesFallback = hueTooClose || labTooClose;

    return {
        organic: usesFallback ? orgFallback : chart1.trim(),
        map,
        info,
        orgFallback,
        usesFallback,
        reason: usesFallback ? (hueTooClose ? 'hue' : 'oklab') : null,
        hueGap: gap,
        deltaE,
    };
}

export function organicColorNote(colors: Pick<SurfaceColors, 'usesFallback'>): string {
    return colors.usesFallback ? ORGANIC_FALLBACK_NOTE : ORGANIC_BRAND_NOTE;
}

/** Round-trip helper so tests can compare a parsed fallback against formatOklch. */
export function fallbackMatchesAuthoredPink(value: string): boolean {
    const parsed = parseOklch(value);
    return parsed != null && formatOklch(parsed) === formatOklch(parseOklch(REPORTING_ORG_FALLBACK_CSS)!);
}
