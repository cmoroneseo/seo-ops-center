import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDelta } from './delta';

test('inside the noise band the delta is a grey approx and never good or bad', () => {
    const delta = formatDelta(103, 100);
    assert.equal(delta.kind, 'noise');
    assert.equal(delta.text, '≈');
    assert.equal(delta.tone, 'neutral');
    assert.equal(delta.percent, undefined);
});

test('a base under 100 does not show a percent', () => {
    const delta = formatDelta(65, 40);
    assert.equal(delta.kind, 'change');
    assert.equal(delta.text, '▲ 25');
    assert.equal(delta.percent, undefined);
    assert.equal(delta.text.includes('%'), false);
});

test('a base of at least 100 shows a percent outside the noise band', () => {
    const delta = formatDelta(200, 100);
    assert.equal(delta.kind, 'change');
    assert.equal(delta.text, '▲ 100 (100.0%)');
    assert.equal(delta.tone, 'good');
    assert.equal(delta.percent, 100);
});

test('a missing prior month has no comparable baseline and a missing value is an em dash', () => {
    assert.deepEqual(formatDelta(65, null), { kind: 'no_baseline', text: 'No comparable baseline', tone: 'neutral' });
    assert.deepEqual(formatDelta(null, 65), { kind: 'missing', text: '—', tone: 'neutral' });
    assert.equal(formatDelta(undefined, 10).text, '—');
    assert.equal(formatDelta('', 10).text, '—');
});

test('a real zero is not rewritten as missing or as a fake baseline', () => {
    const drop = formatDelta(0, 10);
    assert.equal(drop.kind, 'change');
    assert.equal(drop.text, '▼ 10');
    assert.equal(drop.tone, 'bad');
    const fromZero = formatDelta(5, 0);
    assert.equal(fromZero.kind, 'change');
    assert.equal(fromZero.text, '▲ 5');
    assert.equal(fromZero.percent, undefined);
    assert.equal(formatDelta(0, null).text, 'No comparable baseline');
});

test('lower is better flips the tone and percent metrics use the displayed scale', () => {
    const position = formatDelta(20, 8, { lowerIsBetter: true });
    assert.equal(position.text, '▲ 12');
    assert.equal(position.tone, 'bad');
    const improved = formatDelta(8, 20, { lowerIsBetter: true });
    assert.equal(improved.tone, 'good');
    const bounce = formatDelta(0.5, 0.2, { lowerIsBetter: true, scale: 100 });
    assert.equal(bounce.kind, 'change');
    assert.equal(bounce.absolute, 30);
    assert.equal(bounce.tone, 'bad');
    assert.equal(formatDelta(0.5, 0.2).kind, 'noise');
});
