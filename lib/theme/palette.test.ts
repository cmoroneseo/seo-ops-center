import test from 'node:test';
import assert from 'node:assert/strict';

import {
    contrastRatio,
    hexToOklch,
    oklchToHex,
    oklchToRgb,
    rgbToOklch,
    hexToRgb,
} from './color.ts';
import {
    DEFAULT_THEME,
    THEME_PRESETS,
    buildThemeCss,
    buildTokens,
    AA_LARGE,
    AA_NORMAL,
    clampToBand,
    parseTheme,
    previewAccentHex,
    previewHex,
    readableForeground,
    resolveBaseColors,
    surfaceContrast,
    themeContrast,
} from './palette.ts';

test('hex survives a round trip through OKLCH', () => {
    for (const hex of ['#ff0080', '#3b82f6', '#ffffff', '#000000', '#16a34a']) {
        const oklch = hexToOklch(hex);
        assert.ok(oklch, `${hex} should parse`);
        assert.equal(oklchToHex(oklch!), hex);
    }
});

test('short hex and missing hash both parse', () => {
    assert.deepEqual(hexToRgb('#fff'), hexToRgb('FFFFFF'));
});

test('malformed hex is rejected rather than coerced', () => {
    for (const bad of ['', '#12345', 'rebeccapurple', '#gggggg', '#']) {
        assert.equal(hexToOklch(bad), null, `${bad} should not parse`);
    }
});

test('contrast ratio matches known WCAG values', () => {
    const white = hexToRgb('#ffffff')!;
    const black = hexToRgb('#000000')!;
    assert.equal(Math.round(contrastRatio(white, black)), 21);
    assert.equal(Math.round(contrastRatio(white, white)), 1);
});

test('the default preset reproduces the shipped tokens exactly', () => {
    // Guards against a silent rebrand of every existing organization.
    const tokens = buildTokens(DEFAULT_THEME, 'dark');
    assert.equal(tokens['--primary'], 'oklch(0.63 0.26 352)');
    assert.equal(tokens['--accent'], 'oklch(0.7 0.18 20)');
    assert.equal(tokens['--ring'], tokens['--primary']);
    assert.equal(tokens['--sidebar-primary'], tokens['--primary']);
    assert.equal(tokens['--chart-1'], tokens['--primary']);
});

test('every preset clears the large-text floor against its own foreground', () => {
    for (const preset of THEME_PRESETS) {
        for (const mode of ['light', 'dark'] as const) {
            for (const role of ['primary', 'accent'] as const) {
                const ratio = surfaceContrast(clampToBand(preset[role], mode));
                assert.ok(
                    ratio >= AA_LARGE,
                    `${preset.id} ${role} (${mode}) only reaches ${ratio.toFixed(2)}:1`,
                );
            }
        }
    }
});

test('every preset except the legacy default clears AA for normal text', () => {
    // neon-pink is grandfathered: it reproduces the colour the app already
    // shipped, which lands at ~3.85:1. Every preset added since must do better.
    for (const preset of THEME_PRESETS.filter((p) => p.id !== 'neon-pink')) {
        for (const mode of ['light', 'dark'] as const) {
            const ratio = surfaceContrast(clampToBand(preset.primary, mode));
            assert.ok(
                ratio >= AA_NORMAL,
                `${preset.id} primary (${mode}) only reaches ${ratio.toFixed(2)}:1`,
            );
        }
    }
});

test('the default keeps light text on primary, matching the shipped look', () => {
    for (const mode of ['light', 'dark'] as const) {
        const tokens = buildTokens(DEFAULT_THEME, mode);
        assert.equal(tokens['--primary-foreground'], 'oklch(0.985 0 0)');
    }
});

test('the default accent takes ink, a deliberate change from the shipped token', () => {
    // globals.css shipped white on the coral accent at ~3.0:1. Ink reaches
    // ~5.8:1, a decisive enough win to override the light-text preference.
    // Six call sites use text-accent-foreground; this is intentional, not drift.
    for (const mode of ['light', 'dark'] as const) {
        const tokens = buildTokens(DEFAULT_THEME, mode);
        assert.equal(tokens['--accent-foreground'], 'oklch(0.2 0.02 260)');
    }
});

test('a pale brand colour flips to ink instead of shipping invisible text', () => {
    const pale = clampToBand(hexToOklch('#fff59d')!, 'light');
    assert.ok(readableForeground(pale).l < 0.5, 'pale yellow should take ink');
    assert.ok(surfaceContrast(pale) >= AA_NORMAL);
});

test('a dangerously pale brand colour is clamped into the safe band', () => {
    // Pale yellow: white-on-primary would be unreadable if taken literally.
    const theme = { preset: 'custom', hex: '#fff59d' };
    const raw = hexToOklch(theme.hex)!;
    const clamped = clampToBand(resolveBaseColors(theme).primary, 'light');
    assert.ok(raw.l > 0.68, 'fixture should start above the band');
    assert.ok(clamped.l <= 0.68);

    const ratio = contrastRatio(
        oklchToRgb(clamped),
        oklchToRgb(readableForeground(clamped)),
    );
    assert.ok(ratio >= 4.5, `clamped pale yellow reached only ${ratio.toFixed(2)}:1`);
});

test('clamping preserves hue so the brand stays recognisable', () => {
    const theme = { preset: 'custom', hex: '#fff59d' };
    const raw = hexToOklch(theme.hex)!;
    const clamped = clampToBand(resolveBaseColors(theme).primary, 'light');
    assert.ok(Math.abs(clamped.h - raw.h) < 1);
});

test('custom themes stay inside the sRGB gamut', () => {
    for (const hex of ['#ff0080', '#00ff00', '#fff59d', '#050505', '#7c3aed']) {
        for (const mode of ['light', 'dark'] as const) {
            const { r, g, b } = oklchToRgb(clampToBand(hexToOklch(hex)!, mode));
            for (const channel of [r, g, b]) {
                assert.ok(channel >= 0 && channel <= 1, `${hex} left the gamut`);
            }
        }
    }
});

test('a derived accent is a related but distinct hue', () => {
    const { primary, accent } = resolveBaseColors({ preset: 'custom', hex: '#3b82f6' });
    const delta = Math.abs(((accent.h - primary.h + 540) % 360) - 180);
    assert.ok(delta > 10 && delta < 60, `accent hue drifted ${delta.toFixed(1)} degrees`);
    assert.ok(accent.c < primary.c, 'accent should be softer than primary');
});

test('a greyscale brand colour does not produce a garbage hue', () => {
    const grey = rgbToOklch(hexToRgb('#808080')!);
    assert.equal(grey.h, 0);
    assert.ok(grey.c < 0.01);
});

test('parseTheme falls back rather than trusting stored junk', () => {
    assert.deepEqual(parseTheme(null), DEFAULT_THEME);
    assert.deepEqual(parseTheme('neon-pink'), DEFAULT_THEME);
    assert.deepEqual(parseTheme({}), DEFAULT_THEME);
    assert.deepEqual(parseTheme({ preset: 'does-not-exist' }), DEFAULT_THEME);
    assert.deepEqual(parseTheme({ preset: 'custom' }), DEFAULT_THEME);
    assert.deepEqual(parseTheme({ preset: 'custom', hex: 'nope' }), DEFAULT_THEME);
    assert.deepEqual(parseTheme({ preset: 'custom', hex: '#3b82f6' }), {
        preset: 'custom',
        hex: '#3b82f6',
    });
    assert.deepEqual(parseTheme({ preset: 'emerald' }), { preset: 'emerald' });
});

test('an unknown preset renders as the default instead of blanking the UI', () => {
    assert.deepEqual(
        buildTokens({ preset: 'ghost' }, 'dark'),
        buildTokens(DEFAULT_THEME, 'dark'),
    );
});

test('buildThemeCss scopes light and dark blocks', () => {
    const css = buildThemeCss({ preset: 'emerald' });
    assert.ok(css.startsWith(':root{'));
    assert.ok(css.includes('}.dark{'));
    assert.ok(css.endsWith('}'));
    assert.ok(!css.includes('\n'), 'stays a single inline line');
    // Themed tokens only — semantic colours must not be swept in.
    assert.ok(!css.includes('--destructive'));
    assert.ok(!css.includes('--background'));
    assert.ok(!css.includes('--chart-3'));
});

test('previewHex returns distinct primary and accent swatches per preset', () => {
    for (const preset of THEME_PRESETS) {
        const primary = previewHex({ preset: preset.id });
        const accent = previewAccentHex({ preset: preset.id });
        assert.match(primary, /^#[0-9a-f]{6}$/);
        assert.match(accent, /^#[0-9a-f]{6}$/);
        assert.notEqual(primary, accent, `${preset.id} swatches are identical`);
    }
});

test('themeContrast reports the level the picker will display', () => {
    assert.equal(themeContrast({ preset: 'indigo' }).level, 'AA');
    assert.equal(themeContrast(DEFAULT_THEME).level, 'AA Large');
    assert.ok(themeContrast(DEFAULT_THEME).lightText);
    assert.ok(!themeContrast({ preset: 'amber' }).lightText);
});
