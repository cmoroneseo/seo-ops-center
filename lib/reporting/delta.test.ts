import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DISTORTED_FALLBACK_REASON,
    NO_COMPARABLE_BASELINE,
    deltaColumnHeader,
    formatDelta,
    type FormatDeltaContext,
} from './delta.ts';

const MINUS = '−';

interface Row {
    name: string;
    current: unknown;
    previous: unknown;
    ctx?: FormatDeltaContext;
    kind: string;
    text: string;
    tone?: string;
    percent?: number;
    percentHover?: string;
    reason?: string;
    priorLabel?: string;
    header?: string;
    direction?: string;
}

const rows: Row[] = [
    {
        name: 'distorted window strikes the prior and shows no delta',
        current: 200,
        previous: 100,
        ctx: { distorted: { reason: 'History starts mid-period', priorLabel: '100' } },
        kind: 'distorted',
        text: '',
        tone: 'neutral',
        reason: 'History starts mid-period',
        priorLabel: '100',
    },
    {
        name: 'distorted position also shows no arrow',
        current: 8,
        previous: 20,
        ctx: { metric: 'position', distorted: { reason: 'Unequal coverage' } },
        kind: 'distorted',
        text: '',
        tone: 'neutral',
        reason: 'Unequal coverage',
        priorLabel: '20',
        header: 'lower is better',
    },
    {
        name: 'a blank distorted reason still explains the strike',
        current: 12,
        previous: 4,
        ctx: { distorted: { reason: '  ' } },
        kind: 'distorted',
        text: '',
        reason: DISTORTED_FALLBACK_REASON,
    },
    {
        name: 'noise band shows a grey signed approx',
        current: 93,
        previous: 100,
        kind: 'noise',
        text: `≈ ${MINUS}7`,
        tone: 'neutral',
    },
    {
        name: 'the boundary of the band is still noise',
        current: 16,
        previous: 8,
        kind: 'noise',
        text: '≈ +8',
        tone: 'neutral',
    },
    {
        name: 'a base under 100 has no percent',
        current: 65,
        previous: 40,
        kind: 'change',
        text: '▲ 25',
        tone: 'good',
    },
    {
        name: 'staff tiles keep the percent for hover once the base is at least 100',
        current: 200,
        previous: 100,
        ctx: { audience: 'staff' },
        kind: 'change',
        text: '▲ 100',
        tone: 'good',
        percent: 100,
        percentHover: '100.0%',
    },
    {
        name: 'client tiles do not offer the hover percent',
        current: 200,
        previous: 100,
        ctx: { audience: 'client' },
        kind: 'change',
        text: '▲ 100',
        percent: 100,
    },
    {
        name: 'a zero baseline has no comparable baseline',
        current: 5,
        previous: 0,
        kind: 'no_baseline',
        text: NO_COMPARABLE_BASELINE,
        tone: 'neutral',
    },
    {
        name: 'a missing prior month has no comparable baseline',
        current: 65,
        previous: null,
        kind: 'no_baseline',
        text: NO_COMPARABLE_BASELINE,
        tone: 'neutral',
    },
    {
        name: 'a missing current value stays an em dash',
        current: null,
        previous: 65,
        kind: 'missing',
        text: '—',
        tone: 'neutral',
    },
    {
        name: 'position uses an up arrow when the number goes down',
        current: 8,
        previous: 20,
        ctx: { metric: 'position' },
        kind: 'change',
        text: '▲ 12',
        tone: 'good',
        direction: 'up',
        header: 'lower is better',
    },
    {
        name: 'position uses a down arrow when the rank gets worse',
        current: 20,
        previous: 8,
        ctx: { metric: 'position' },
        kind: 'change',
        text: '▼ 12',
        tone: 'bad',
        direction: 'down',
        header: 'lower is better',
    },
    {
        name: 'october cards keep a bare approx',
        current: 103,
        previous: 100,
        ctx: { presentation: 'legacy' },
        kind: 'noise',
        text: '≈',
        tone: 'neutral',
    },
    {
        name: 'october cards keep a real zero prior as a change',
        current: 5,
        previous: 0,
        ctx: { presentation: 'legacy' },
        kind: 'change',
        text: '▲ 5',
        tone: 'good',
    },
    {
        name: 'october cards keep the percent inline and the numeric arrow',
        current: 20,
        previous: 8,
        ctx: { presentation: 'legacy', lowerIsBetter: true },
        kind: 'change',
        text: '▲ 12',
        tone: 'bad',
        direction: 'up',
    },
];

for (const row of rows) {
    test(`formatDelta: ${row.name}`, () => {
        const delta = formatDelta(row.current, row.previous, row.ctx);
        assert.equal(delta.kind, row.kind);
        assert.equal(delta.text, row.text);
        if (row.tone) assert.equal(delta.tone, row.tone);
        if (row.kind === 'change' || row.kind === 'noise' || row.kind === 'distorted') {
            assert.equal(delta.text.includes('%'), row.percentHover != null && row.ctx?.presentation === 'legacy');
        }
        if (row.percent === undefined) assert.equal(delta.percent, undefined);
        else assert.equal(delta.percent, row.percent);
        assert.equal(delta.percentHover, row.percentHover);
        if (row.reason) assert.equal(delta.reason, row.reason);
        if (row.priorLabel) assert.equal(delta.priorLabel, row.priorLabel);
        if (row.header) assert.equal(delta.header, row.header);
        if (row.direction) assert.equal(delta.direction, row.direction);
        if (row.kind === 'distorted') assert.equal(delta.text.includes('▲') || delta.text.includes('▼'), false);
    });
}

test('position headers say lower is better', () => {
    assert.equal(deltaColumnHeader('Avg position', 'position'), 'Avg position (lower is better)');
    assert.equal(deltaColumnHeader('Clicks', 'count'), 'Clicks');
});
