import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTokens, type ThemeMode } from './palette.ts';
import {
    ORGANIC_BRAND_NOTE,
    ORGANIC_FALLBACK_NOTE,
    REPORTING_INFO_CSS,
    REPORTING_MAP_CSS,
    REPORTING_ORG_FALLBACK_CSS,
    organicColorNote,
    resolveSurfaceColors,
} from './surface-colors.ts';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../app/globals.css'), 'utf8');

const FALLBACK = ['electric-blue', 'cyan', 'indigo'] as const;
const BRAND = ['neon-pink', 'emerald', 'violet', 'amber', 'crimson'] as const;

test('reporting tokens are namespaced and the plan aliases point at them', () => {
    assert.match(css, /--reporting-map:\s*oklch\(0\.72 0\.13 235\)/);
    assert.match(css, /--reporting-map:\s*oklch\(0\.48 0\.13 235\)/);
    assert.match(css, /--reporting-info:\s*oklch\(0\.74 0\.03 260\)/);
    assert.match(css, /--reporting-info:\s*oklch\(0\.50 0\.03 260\)/);
    assert.match(css, /--reporting-org-fallback:\s*oklch\(0\.63 0\.26 352\)/);
    assert.match(css, /--color-map:\s*var\(--reporting-map\)/);
    assert.match(css, /--color-info:\s*var\(--reporting-info\)/);
    assert.equal(REPORTING_MAP_CSS.dark, 'oklch(0.72 0.13 235)');
    assert.equal(REPORTING_INFO_CSS.dark, 'oklch(0.74 0.03 260)');
    assert.equal(REPORTING_INFO_CSS.light, 'oklch(0.50 0.03 260)');
    assert.equal(REPORTING_ORG_FALLBACK_CSS, 'oklch(0.63 0.26 352)');
});

test('blue presets fall back to pink and the default theme keeps chart-1', () => {
    for (const mode of ['light', 'dark'] as ThemeMode[]) {
        for (const preset of FALLBACK) {
            const tokens = buildTokens({ preset }, mode);
            const surface = resolveSurfaceColors(tokens, mode);
            assert.equal(surface.usesFallback, true, `${preset} ${mode} hueGap=${surface.hueGap} deltaE=${surface.deltaE}`);
            assert.equal(surface.organic, REPORTING_ORG_FALLBACK_CSS, preset);
            assert.equal(surface.reason, 'hue', preset);
            assert.equal(organicColorNote(surface), ORGANIC_FALLBACK_NOTE);
            assert.ok(surface.hueGap <= 40, `${preset} hue gap ${surface.hueGap}`);
        }

        for (const preset of BRAND) {
            const tokens = buildTokens({ preset }, mode);
            const surface = resolveSurfaceColors(tokens, mode);
            assert.equal(surface.usesFallback, false, `${preset} ${mode} hueGap=${surface.hueGap} deltaE=${surface.deltaE}`);
            assert.equal(surface.organic, tokens['--chart-1'], preset);
            assert.equal(surface.reason, null, preset);
            assert.equal(organicColorNote(surface), ORGANIC_BRAND_NOTE);
        }
    }
});

test('indigo sits on a 40 degree hue gap, past the OKLab cutoff', () => {
    const surface = resolveSurfaceColors(buildTokens({ preset: 'indigo' }, 'dark'), 'dark');
    assert.ok(Math.abs(surface.hueGap - 40) < 1e-6, `hue gap was ${surface.hueGap}`);
    assert.ok(surface.deltaE >= 0.12, `deltaE was ${surface.deltaE}`);
    assert.equal(surface.usesFallback, true);
});

test('the appearance note uses the fallback sentence only when organic leaves chart-1', () => {
    assert.equal(ORGANIC_FALLBACK_NOTE, 'Organic search color: pink (your theme is too close to map-pack blue)');
    const pink = resolveSurfaceColors(buildTokens({ preset: 'neon-pink' }, 'dark'), 'dark');
    const blue = resolveSurfaceColors(buildTokens({ preset: 'electric-blue' }, 'dark'), 'dark');
    assert.equal(organicColorNote(pink), ORGANIC_BRAND_NOTE);
    assert.equal(organicColorNote(blue), ORGANIC_FALLBACK_NOTE);
    assert.equal(pink.organic, pink.orgFallback);
    assert.equal(pink.usesFallback, false);
});
