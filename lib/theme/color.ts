/**
 * OKLCH <-> sRGB conversion + WCAG contrast.
 *
 * Pure math, no DOM. The app's design tokens are authored in OKLCH
 * (see app/globals.css), so brand theming works in OKLCH too: we clamp
 * lightness into a safe band and pick foregrounds by measured contrast
 * instead of hoping a hand-picked hex is readable.
 */

export interface Oklch {
    /** 0..1 */
    l: number;
    /** 0..~0.37 */
    c: number;
    /** degrees, 0..360 */
    h: number;
}

export interface Rgb {
    /** each 0..1 */
    r: number;
    g: number;
    b: number;
}

function srgbToLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function hexToRgb(hex: string): Rgb | null {
    const cleaned = hex.trim().replace(/^#/, '');
    const full =
        cleaned.length === 3
            ? cleaned.split('').map((ch) => ch + ch).join('')
            : cleaned;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
    return {
        r: parseInt(full.slice(0, 2), 16) / 255,
        g: parseInt(full.slice(2, 4), 16) / 255,
        b: parseInt(full.slice(4, 6), 16) / 255,
    };
}

export function rgbToHex({ r, g, b }: Rgb): string {
    const part = (n: number) =>
        Math.round(clamp01(n) * 255).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`;
}

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);

    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

    const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

    const chroma = Math.sqrt(okA * okA + okB * okB);
    let hue = (Math.atan2(okB, okA) * 180) / Math.PI;
    if (hue < 0) hue += 360;

    return { l: okL, c: chroma, h: chroma < 1e-6 ? 0 : hue };
}

/** Raw conversion — may fall outside the sRGB gamut. */
export function oklchToRgbRaw({ l, c, h }: Oklch): Rgb {
    const hRad = (h * Math.PI) / 180;
    const a = c * Math.cos(hRad);
    const b = c * Math.sin(hRad);

    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

    return {
        r: linearToSrgb(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
        g: linearToSrgb(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
        b: linearToSrgb(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
    };
}

function inGamut({ r, g, b }: Rgb): boolean {
    const eps = 1e-4;
    return [r, g, b].every((v) => v >= -eps && v <= 1 + eps);
}

/**
 * Reduce chroma until the colour fits inside sRGB, preserving lightness and
 * hue. Without this, a high-chroma OKLCH value renders as a clipped, muddy
 * approximation whose real contrast differs from the computed one.
 */
export function fitToGamut(color: Oklch): Oklch {
    if (inGamut(oklchToRgbRaw(color))) return color;
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(oklchToRgbRaw({ ...color, c: mid }))) lo = mid;
        else hi = mid;
    }
    return { ...color, c: lo };
}

export function oklchToRgb(color: Oklch): Rgb {
    const fitted = fitToGamut(color);
    const raw = oklchToRgbRaw(fitted);
    return { r: clamp01(raw.r), g: clamp01(raw.g), b: clamp01(raw.b) };
}

export function oklchToHex(color: Oklch): string {
    return rgbToHex(oklchToRgb(color));
}

export function hexToOklch(hex: string): Oklch | null {
    const rgb = hexToRgb(hex);
    return rgb ? rgbToOklch(rgb) : null;
}

/** CSS `oklch(...)` string, rounded to the precision globals.css uses. */
export function formatOklch({ l, c, h }: Oklch): string {
    const round = (n: number, p: number) => Number(n.toFixed(p));
    return `oklch(${round(l, 3)} ${round(c, 3)} ${round(h, 1)})`;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
    return (
        0.2126 * srgbToLinear(r) +
        0.7152 * srgbToLinear(g) +
        0.0722 * srgbToLinear(b)
    );
}

/** WCAG 2.1 contrast ratio, 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}
