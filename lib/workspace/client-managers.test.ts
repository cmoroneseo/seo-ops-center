import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManagerOptions, matchesManager, isMyClient, clientManagerId } from './client-managers';
const abel = { id: 'abel-id', name: 'Abel Miranda', email: 'abel@example.com' };
const carlos = { id: 'carlos-id', name: 'Carlos Morones' };
const clients = [
    { accountManager: 'Abel', accountManagerId: abel.id },
    { accountManager: 'Abel Miranda', accountManagerId: abel.id },
    { accountManager: ' Abel ', accountManagerId: undefined },
    { accountManager: 'Carlos Morones', accountManagerId: carlos.id },
];
test('manager aliases share one canonical option and filter', () => {
    const options = buildManagerOptions(clients, [abel, carlos]);
    assert.deepEqual(options.map(option => option.label), ['Abel Miranda', 'Carlos Morones']);
    assert.equal(clients.filter(client => matchesManager(client, options[0], clients, [abel, carlos])).length, 3);
});
test('My Clients uses IDs even when a stored name is stale', () => {
    assert.equal(isMyClient({ accountManager: 'Carlos Morones', accountManagerId: abel.id }, carlos, clients, [abel, carlos]), false);
    assert.equal(isMyClient(clients[0], abel, clients, [abel, carlos]), true);
    assert.equal(isMyClient(clients[0], {id:'',name:'Abel'}, clients), false);
});
test('legacy records resolve full names and email without guessing ambiguous first names', () => {
    const members = [abel, { id: 'other-abel', name: 'Abel Smith' }];
    assert.equal(clientManagerId({accountManager:'Abel'}, members), undefined);
    assert.equal(clientManagerId({accountManager:'ABEL MIRANDA'}, members), abel.id);
    assert.equal(clientManagerId({accountManager:'abel@example.com'}, members), abel.id);
    assert.equal(isMyClient({accountManager:'Carlos Morones'}, carlos, []), true);
    assert.equal(buildManagerOptions([{accountManager:'Abel'},{accountManager:'Abel Miranda',accountManagerId:abel.id}], members).length, 2);
});
