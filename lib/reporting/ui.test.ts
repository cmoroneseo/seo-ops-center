import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contrastRatio, oklchToRgb } from '../theme/color.ts';
import { parseOklch } from '../theme/surface-colors.ts';
import { DeltaHeader, DeltaText } from '../../components/reporting/DeltaText.tsx';
import { Receipt } from '../../components/reporting/Receipt.tsx';
import { SourceChip } from '../../components/reporting/SourceChip.tsx';
import { StateBanner } from '../../components/reporting/StateBanner.tsx';
import { resolveFreshness } from './freshness.ts';
import {
    INSIGHTS_LINK_LABEL,
    RECEIPT_HOVER_OPEN_MS,
    buildReceiptContent,
    commitReceiptSignal,
    type ReceiptInput,
} from './receipt.ts';

const root = dirname(fileURLToPath(import.meta.url));

function receiptInput(over: Partial<ReceiptInput> = {}): ReceiptInput {
    return {
        title: 'Clicks to your website',
        value: '65',
        freshness: 'Fresh',
        source: 'Google Search Console',
        property: 'sc-domain:example.com',
        dates: 'Sep 1–30, 2026',
        method: 'Search Analytics query',
        note: 'Final month.',
        audience: 'staff',
        tier: 'A',
        clientId: 'client-1',
        range: '2026-09',
        ...over,
    };
}

function renderReceipt(over: Partial<ReceiptInput> = {}, open = false) {
    return renderToStaticMarkup(createElement(Receipt, {
        input: receiptInput(over),
        initialInteraction: open ? { open: true, pinned: true } : { open: false, pinned: false },
    }));
}

test('receipt trigger exposes dialog semantics', () => {
    const closed = renderReceipt();
    assert.match(closed, /role="button"/);
    assert.match(closed, /aria-haspopup="dialog"/);
    assert.match(closed, /aria-expanded="false"/);
    assert.match(closed, /tabindex="0"/);
    assert.match(closed, /aria-label="65: show source"/);
    assert.equal(closed.includes('role="dialog"'), false);
    assert.match(closed, /reporting-receipt-tier-a/);

    const tierB = renderReceipt({ tier: 'B' });
    assert.match(tierB, /reporting-receipt-tier-b/);
    assert.equal(tierB.includes('reporting-receipt-tier-a'), false);
});

test('escape closes a pinned receipt and returns focus to the trigger', () => {
    const open = renderReceipt({}, true);
    assert.match(open, /aria-expanded="true"/);
    assert.match(open, /role="dialog"/);
    assert.match(open, /aria-labelledby="/);
    assert.match(open, /bg-popover/);
    assert.match(open, /text-popover-foreground/);

    const trigger = {
        focused: false,
        focus() {
            this.focused = true;
        },
    };
    const next = commitReceiptSignal({ open: true, pinned: true }, { type: 'escape' }, trigger);
    assert.equal(trigger.focused, true);
    assert.deepEqual(next, { open: false, pinned: false });

    const closed = renderToStaticMarkup(createElement(Receipt, {
        input: receiptInput(),
        initialInteraction: next,
    }));
    assert.match(closed, /role="button"/);
    assert.match(closed, /aria-haspopup="dialog"/);
    assert.match(closed, /aria-expanded="false"/);
    assert.equal(closed.includes('role="dialog"'), false);
});

test('a staff receipt stays within seven rows and links to the same range', () => {
    assert.equal(RECEIPT_HOVER_OPEN_MS, 150);
    const content = buildReceiptContent(receiptInput());
    assert.equal(content.rows.length, 7);
    assert.deepEqual(content.rows.map((row) => row.label), [
        'Value',
        'Freshness',
        'Source',
        'Property',
        'Dates',
        'Method',
        'Note',
    ]);
    assert.equal(content.insightsLabel, INSIGHTS_LINK_LABEL);
    assert.equal(content.insightsHref, '/workspace/client-1?range=2026-09');

    const html = renderReceipt({}, true);
    assert.match(html, /Open in Search Insights →/);
    assert.match(html, /href="\/workspace\/client-1\?range=2026-09"/);
    assert.equal((html.match(/data-receipt-row=/g) ?? []).length, 7);
});

test('a client receipt drops property, method, and the staff link', () => {
    const content = buildReceiptContent(receiptInput({ audience: 'client' }));
    assert.equal(content.insightsHref, null);
    assert.equal(content.rows.some((row) => row.label === 'Property' || row.label === 'Method'), false);
    const html = renderReceipt({ audience: 'client' }, true);
    assert.equal(html.includes('sc-domain:example.com'), false);
    assert.equal(html.includes('Search Analytics query'), false);
    assert.equal(html.includes('Open in Search Insights'), false);
});

test('frozen receipts read the snapshot and only non-default tags render', () => {
    const frozen = buildReceiptContent(receiptInput({ frozenAt: 'Oct 2, 2026', tag: 'prelim' }));
    assert.equal(frozen.tag, 'snapshot');
    assert.equal(frozen.rows.find((row) => row.label === 'Freshness')?.value, 'Snapshot locked Oct 2, 2026');
    const html = renderReceipt({ tag: 'prelim' });
    assert.match(html, /data-receipt-tag="prelim"/);
    assert.match(html, />prelim</);
    const plain = renderReceipt();
    assert.equal(plain.includes('data-receipt-tag'), false);
});

test('client copy lint rejects a banned sentence before it reaches the receipt', () => {
    const content = buildReceiptContent(receiptInput({
        audience: 'client',
        note: '65 people clicked',
        metricSources: ['gsc'],
    }));
    assert.match(content.copyIssue ?? '', /Client copy rejected/);
    assert.equal(content.rows.some((row) => row.value.includes('people')), false);
    const html = renderReceipt({
        audience: 'client',
        note: '65 people clicked',
        metricSources: ['gsc'],
    }, true);
    assert.equal(html.includes('people'), false);
});

test('receipt popover tokens clear AA for body text', () => {
    const pairs = [
        ['oklch(0.12 0 0)', 'oklch(0.985 0 0)'],
        ['oklch(1 0 0)', 'oklch(0.2 0.02 260)'],
    ];
    for (const [background, foreground] of pairs) {
        const ratio = contrastRatio(oklchToRgb(parseOklch(background)!), oklchToRgb(parseOklch(foreground)!));
        assert.ok(ratio >= 4.5, `${background} on ${foreground} is ${ratio.toFixed(2)}:1`);
    }
});

test('delta text follows the shared rule and position headers say lower is better', () => {
    const noise = renderToStaticMarkup(createElement(DeltaText, { current: 93, previous: 100 }));
    assert.match(noise, /text-muted-foreground/);
    assert.match(noise, /≈ −7/);
    assert.equal(noise.includes('text-green-600'), false);
    assert.equal(noise.includes('text-red-600'), false);

    const position = renderToStaticMarkup(createElement(DeltaText, {
        current: 8,
        previous: 20,
        context: { metric: 'position' },
    }));
    assert.match(position, /▲ 12/);
    assert.match(position, /data-lower-is-better="true"/);
    assert.match(position, /text-green-600/);

    const staff = renderToStaticMarkup(createElement(DeltaText, {
        current: 200,
        previous: 100,
        context: { audience: 'staff' },
    }));
    assert.match(staff, /title="100\.0%"/);
    assert.match(staff, />▲ 100</);
    assert.equal(staff.includes('>▲ 100 ('), false);

    const small = renderToStaticMarkup(createElement(DeltaText, { current: 65, previous: 40 }));
    assert.equal(small.includes('title='), false);
    assert.match(small, />▲ 25</);

    const distorted = renderToStaticMarkup(createElement(DeltaText, {
        current: 8,
        previous: 20,
        context: { metric: 'position', distorted: { reason: 'History starts mid-period', priorLabel: '20' } },
    }));
    assert.match(distorted, /<s/);
    assert.match(distorted, /History starts mid-period/);
    assert.equal(distorted.includes('▲'), false);
    assert.equal(distorted.includes('▼'), false);

    const baseline = renderToStaticMarkup(createElement(DeltaText, { current: 5, previous: 0 }));
    assert.match(baseline, /No comparable baseline/);

    const header = renderToStaticMarkup(createElement(DeltaHeader, { label: 'Avg position', metric: 'position' }));
    assert.equal(header, '<span>Avg position (lower is better)</span>');
});

test('state banners keep a real zero neutral and pair info with the icon', () => {
    const base = {
        source: 'gsc' as const,
        connected: true,
        lastSyncAt: new Date('2026-10-08T19:00:00.000Z'),
        lastSyncErrored: false,
        now: new Date('2026-10-08T20:00:00.000Z'),
        historyCoversWindow: true,
        backfillRunning: false,
        value: 0,
    };
    const empty = resolveFreshness(base);
    const emptyHtml = renderToStaticMarkup(createElement(StateBanner, { readout: empty }));
    assert.match(emptyHtml, /data-value="0"/);
    assert.match(emptyHtml, /A real zero for this window\./);
    assert.equal(emptyHtml.includes('text-green'), false);
    assert.equal(emptyHtml.includes('—'), false);

    const missing = resolveFreshness({ ...base, connected: false, notConnectedReason: "Search Console isn't connected.", value: 0 });
    const missingHtml = renderToStaticMarkup(createElement(StateBanner, { readout: missing }));
    assert.match(missingHtml, /ⓘ/);
    assert.match(missingHtml, /reporting-info/);
    assert.match(missingHtml, /data-value="—"/);
    assert.match(missingHtml, /Search Console isn&#x27;t connected\./);

    const freshHtml = renderToStaticMarkup(createElement(StateBanner, {
        readout: resolveFreshness({ ...base, value: 65 }),
    }));
    assert.equal(freshHtml, '');

    const chip = renderToStaticMarkup(createElement(SourceChip, {
        source: 'Google Search Console',
        rangeLabel: 'Sep 1–30, 2026',
        staleLabel: 'as of Oct 8, 2026',
    }));
    assert.match(chip, /Google Search Console/);
    assert.match(chip, /Sep 1–30, 2026/);
    assert.match(chip, /as of Oct 8, 2026/);
});

test('reporting components do not use a raw blue utility, and receipt motion is opacity only', () => {
    const blue = /\b(?:bg|text|border|ring|outline|from|to|via|fill|stroke|decoration)-(?:blue|sky|indigo|cyan)-\d+/;
    const dir = join(root, '../../components/reporting');
    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.tsx')) continue;
        const source = readFileSync(join(dir, file), 'utf8');
        assert.equal(blue.test(source), false, file);
    }

    const css = readFileSync(join(root, '../../app/globals.css'), 'utf8');
    const motion = css.slice(css.indexOf('.reporting-receipt-popover'));
    assert.match(motion, /prefers-reduced-motion:\s*reduce/);
    assert.match(motion, /transition:\s*opacity/);
    assert.equal(motion.includes('transform'), false);
    assert.match(css, /color-mix\(in oklch, var\(--muted\) 45%, transparent\)/);
});
