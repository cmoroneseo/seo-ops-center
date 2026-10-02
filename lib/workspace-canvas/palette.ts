/**
 * Canvas palette rules.
 *
 * Brand actions and the search series use the active organization tokens
 * (`--primary`, `--chart-1`, `--accent` / `--chart-2`). Semantic status
 * colors stay the fixed green / blue / amber / red palette. The concept
 * lime is not a token and is not introduced here.
 *
 * Filled primary buttons keep `--primary-foreground` when that pair clears
 * WCAG AA for normal text (4.5:1). The shipped neon-pink pair is about
 * 3.85:1 (AA Large only); in that case the canvas uses foreground ink on
 * the primary fill when ink clears 4.5, and a neutral fill when neither does.
 * Global theme tokens are not rewritten.
 */

import { contrastRatio, oklchToRgb, type Oklch } from '../theme/color';

export type ActionForeground = 'token' | 'ink' | 'neutral';

export function parseOklch(value: string): Oklch | null {
    const match = value.trim().match(/^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*[0-9.]+%?)?\s*\)$/i);
    if (!match) return null;
    const l = Number(match[1]);
    const c = Number(match[2]);
    const h = Number(match[3]);
    if (![l, c, h].every(Number.isFinite)) return null;
    return { l, c, h };
}

export function oklchContrast(a: string, b: string): number | null {
    const left = parseOklch(a);
    const right = parseOklch(b);
    if (!left || !right) return null;
    return contrastRatio(oklchToRgb(left), oklchToRgb(right));
}

/** Pick a local label treatment. Does not change saved organization colors. */
export function actionForegroundChoice(ratios: { token: number | null; ink: number | null }): ActionForeground {
    if (ratios.token != null && ratios.token >= 4.5) return 'token';
    if (ratios.ink != null && ratios.ink >= 4.5) return 'ink';
    return 'neutral';
}

export const CANVAS_COLOR_ROLES = {
    cta: '--primary, --primary-foreground, --ring',
    trafficSeries: '--chart-1',
    secondaryBrand: '--accent / --chart-2',
    previousSeries: '--muted-foreground',
    surfaces: '--background, --card, --popover',
    text: '--foreground, --muted-foreground, --border',
    success: 'semantic green (unchanged)',
    info: 'semantic blue (unchanged)',
    attention: 'semantic amber and destructive (unchanged)',
} as const;
