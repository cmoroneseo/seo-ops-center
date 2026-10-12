import test from 'node:test';
import assert from 'node:assert/strict';

import { selectVisibleSilos } from './visible-silos.ts';

const silos = [{ id: 's-1' }, { id: 's-2' }];
const open = { action: 'all', pageType: 'all', status: 'all' };

test('manual add can reach a silo that has no records yet', () => {
    assert.deepEqual(selectVisibleSilos(silos, [{ siloId: 's-1' }], 'all', open, true), silos);
    assert.deepEqual(selectVisibleSilos(silos, [{ siloId: 's-1' }], 'all', open, false).map(silo => silo.id), ['s-1']);
});

test('an active filter still hides silos with no matching records', () => {
    const filtered = { action: 'all', pageType: 'all', status: 'approved' };
    assert.deepEqual(selectVisibleSilos(silos, [], 'all', filtered, true), []);
    assert.deepEqual(
        selectVisibleSilos(silos, [], 's-2', filtered, true).map(silo => silo.id),
        ['s-2'],
    );
});
