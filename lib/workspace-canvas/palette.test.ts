import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTokens } from '../theme/palette.ts';
import { actionForegroundChoice, oklchContrast, parseOklch } from './palette.ts';

const LIGHT_INK = 'oklch(0.2 0.02 260)';
const DARK_INK = 'oklch(0.985 0 0)';
const LIGHT_CARD = 'oklch(1 0 0)';
const DARK_CARD = 'oklch(0.12 0 0)';
const LIGHT_MUTED = 'oklch(0.5 0.02 260)';
const DARK_MUTED = 'oklch(0.65 0 0)';

function pair(theme: Parameters<typeof buildTokens>[0], mode: 'light' | 'dark') {
    const tokens = buildTokens(theme, mode);
    const ink = mode === 'light' ? LIGHT_INK : DARK_INK;
    const card = mode === 'light' ? LIGHT_CARD : DARK_CARD;
    return {
        token: oklchContrast(tokens['--primary'], tokens['--primary-foreground']),
        ink: oklchContrast(tokens['--primary'], ink),
        chartOnCard: oklchContrast(tokens['--chart-1'], card),
        mutedOnCard: oklchContrast(mode === 'light' ? LIGHT_MUTED : DARK_MUTED, card),
    };
}

test('canvas actions use a readable label without introducing lime', () => {
    const themes = [
        pair({ preset: 'neon-pink' }, 'dark'),
        pair({ preset: 'neon-pink' }, 'light'),
        pair({ preset: 'electric-blue' }, 'light'),
        pair({ preset: 'electric-blue' }, 'dark'),
        pair({ preset: 'custom', hex: '#0f766e' }, 'dark'),
        pair({ preset: 'custom', hex: '#0f766e' }, 'light'),
    ];
    for (const ratios of themes) {
        assert.ok(ratios.token != null && ratios.token >= 3, `primary button below 3:1 (${ratios.token})`);
        const choice = actionForegroundChoice(ratios);
        if (choice === 'token') assert.ok((ratios.token ?? 0) >= 4.5);
        if (choice === 'ink') assert.ok((ratios.ink ?? 0) >= 4.5);
        if ((ratios.token ?? 0) < 4.5) assert.notEqual(choice, 'token');
        assert.ok((ratios.chartOnCard ?? 0) >= 3, `chart series below 3:1 (${ratios.chartOnCard})`);
        assert.ok((ratios.mutedOnCard ?? 0) >= 3, `previous-series gray below 3:1 (${ratios.mutedOnCard})`);
    }
    const neonDark = pair({ preset: 'neon-pink' }, 'dark');
    assert.ok((neonDark.token ?? 0) < 4.5, 'neon pink is the grandfathered AA Large pair');
    assert.notEqual(actionForegroundChoice(neonDark), 'token');
    assert.equal(parseOklch('lime'), null);
    assert.equal(parseOklch('oklch(0.63 0.26 352)')?.h, 352);
});
