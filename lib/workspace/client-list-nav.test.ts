import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { activeClientId, clientListHref, clientListRowClass } from './client-list-nav.ts';

test('a client row links straight to that client page', () => {
    assert.equal(clientListHref('/dashboard', 'vita'), '/workspace/vita');
    assert.equal(clientListHref('/workspace', 'vita'), '/workspace/vita');
    assert.equal(clientListHref('/workspace/other', 'vita'), '/workspace/vita');
    assert.notEqual(clientListHref('/workspace', 'vita'), '/workspace');
    assert.equal(clientListHref('/workspace', 'vita').includes('/clients'), false);
});

test('the tasks board keeps its own client filter', () => {
    assert.equal(clientListHref('/tasks', 'vita'), '/tasks?client=vita');
    assert.equal(activeClientId('/tasks', 'vita'), 'vita');
    assert.equal(activeClientId('/tasks', null), null);
});

test('the open workspace client is the active row, including query strings the path ignores', () => {
    assert.equal(activeClientId('/workspace/vita', null), 'vita');
    assert.equal(activeClientId('/workspace/vita', 'other'), 'vita');
    assert.equal(activeClientId('/dashboard', null), null);
    assert.equal(activeClientId('/workspace', null), null);
});

test('rows are at least 32px and active is distinct from hover', () => {
    const active = clientListRowClass(true);
    const idle = clientListRowClass(false);
    assert.match(active, /min-h-8/);
    assert.match(idle, /min-h-8/);
    assert.match(active, /bg-primary\/15/);
    assert.match(idle, /hover:bg-accent/);
    assert.equal(idle.includes('bg-primary/15'), false);
});

test('the client segment shows its own loading shell instead of leaving the list up', () => {
    const loading = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/loading.tsx', import.meta.url), 'utf8');
    assert.match(loading, /Loading client/);
    assert.equal(loading.includes('Active Clients'), false);
    assert.equal(loading.includes('Loading client workspace'), false);
});
