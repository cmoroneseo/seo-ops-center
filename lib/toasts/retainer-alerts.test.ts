import test from 'node:test';
import assert from 'node:assert/strict';

import {
    partitionRetainerWarnings,
    rememberRetainerShown,
    resetRetainerShownForTests,
    retainVisibleRetainerToast,
    retainerContextClientId,
    retainerWarnings,
    readRetainerShownIds,
    type RetainerUsageClient,
} from './retainer-alerts.ts';
import {
    markRetainerTrayRead,
    resetRetainerTrayForTests,
    retainerTraySnapshot,
    syncRetainerTray,
} from './retainer-tray.ts';
import { toastClearancePx } from './toast-clearance.ts';

const vita: RetainerUsageClient = { id: 'vita', name: 'Vitatherapy Wellness Medspa', seoHours: 10, status: 'Active', customScope: false };
const hr: RetainerUsageClient = { id: 'hr', name: 'HR Innovator Group', seoHours: 10, status: 'Active', customScope: false };
const quiet: RetainerUsageClient = { id: 'quiet', name: 'Quiet Co', seoHours: 10, status: 'Active', customScope: false };
const custom: RetainerUsageClient = { id: 'custom', name: 'Custom Co', seoHours: 10, status: 'Active', customScope: true };

function warnings() {
    return retainerWarnings(
        [vita, hr, quiet, custom],
        { vita: 8.3, hr: 8.2, quiet: 2, custom: 9 },
        '2026-10',
    );
}

test('retainer warnings are the 80–99% band for active monthly retainers', () => {
    const found = warnings();
    assert.deepEqual(found.map(warning => warning.clientName), [
        'Vitatherapy Wellness Medspa',
        'HR Innovator Group',
    ]);
    assert.equal(found[0].percent, 83);
    assert.equal(found[1].percent, 82);
    assert.match(found[0].message, /83% of their monthly retainer/);
});

test('only the client in context becomes a toast; the rest go to the tray', () => {
    const { toast, tray } = partitionRetainerWarnings({
        warnings: warnings(),
        contextClientId: 'vita',
        dismissedIds: new Set(),
        shownIds: new Set(),
    });
    assert.equal(toast?.clientId, 'vita');
    assert.deepEqual(tray.map(item => item.clientId), ['hr']);
});

test('with no client in context every warning stays in the tray', () => {
    const { toast, tray } = partitionRetainerWarnings({
        warnings: warnings(),
        contextClientId: null,
        dismissedIds: new Set(),
        shownIds: new Set(),
    });
    assert.equal(toast, null);
    assert.deepEqual(tray.map(item => item.clientId), ['vita', 'hr']);
});

test('a warning already shown this session does not toast again; it joins the tray', () => {
    const shown = warnings();
    const { toast, tray } = partitionRetainerWarnings({
        warnings: shown,
        contextClientId: 'vita',
        dismissedIds: new Set(),
        shownIds: new Set([shown[0].id]),
    });
    assert.equal(toast, null);
    assert.deepEqual(tray.map(item => item.clientId), ['vita', 'hr']);
});

test('a toast that is still on screen is kept there and left out of the tray', () => {
    const shown = warnings();
    const current = shown[0];
    const partitioned = partitionRetainerWarnings({
        warnings: shown,
        contextClientId: 'vita',
        dismissedIds: new Set(),
        shownIds: new Set([current.id]),
    });
    const kept = retainVisibleRetainerToast(partitioned.toast, current, 'vita', new Set());
    assert.equal(kept?.clientId, 'vita');
    assert.deepEqual(
        partitioned.tray.filter(item => item.id !== kept?.id).map(item => item.clientId),
        ['hr'],
    );
});

test('dismissed warnings are neither a toast nor a tray row', () => {
    const shown = warnings();
    const { toast, tray } = partitionRetainerWarnings({
        warnings: shown,
        contextClientId: 'hr',
        dismissedIds: new Set([shown[1].id]),
        shownIds: new Set(),
    });
    assert.equal(toast, null);
    assert.deepEqual(tray.map(item => item.clientId), ['vita']);
});

test('context is the open workspace client, then the running timer', () => {
    assert.equal(retainerContextClientId('/workspace/vita', 'hr'), 'vita');
    assert.equal(retainerContextClientId('/workspace/vita?tab=overview', null), 'vita');
    assert.equal(retainerContextClientId('/dashboard', 'hr'), 'hr');
    assert.equal(retainerContextClientId('/dashboard', null), null);
    assert.equal(retainerContextClientId('/workspace', 'hr'), 'hr');
});

test('remembering a toast survives a fresh read in this session', () => {
    resetRetainerShownForTests();
    rememberRetainerShown('retainer:vita:2026-10');
    assert.equal(readRetainerShownIds().has('retainer:vita:2026-10'), true);
    resetRetainerShownForTests();
    assert.equal(readRetainerShownIds().has('retainer:vita:2026-10'), false);
});

test('tray rows keep their read state when the warning list refreshes', () => {
    resetRetainerTrayForTests();
    syncRetainerTray([{ id: 'retainer:hr:2026-10', clientId: 'hr', title: 'HR', body: '82%' }]);
    markRetainerTrayRead('retainer:hr:2026-10');
    syncRetainerTray([
        { id: 'retainer:hr:2026-10', clientId: 'hr', title: 'HR', body: '82%' },
        { id: 'retainer:vita:2026-10', clientId: 'vita', title: 'Vita', body: '83%' },
    ]);
    const rows = retainerTraySnapshot();
    assert.equal(rows.find(row => row.clientId === 'hr')?.isRead, true);
    assert.equal(rows.find(row => row.clientId === 'vita')?.isRead, false);
    resetRetainerTrayForTests();
});

test('toast clearance sits the stack above the timer with a gap', () => {
    // Timer top is 200px above the bottom of an 800px viewport.
    assert.equal(toastClearancePx(800, 600, 16), 216);
    assert.ok(toastClearancePx(800, 600, 16) > 800 - 600);
});
