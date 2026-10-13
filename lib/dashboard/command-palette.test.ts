import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandPaletteResults, commandPaletteShowsEmpty } from '../../components/dashboard/CommandPaletteResults.tsx';
import { matchingVaultCommands, vaultCommands } from '../vault/commands.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const clientId = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';
const vault = vaultCommands({ enabled: true, clientId, role: 'admin' }).map(command => ({
    id: command.id,
    label: command.label,
}));

function render(query: string, clients: { id: string; name: string; detail: string }[] = []) {
    return renderToStaticMarkup(createElement(CommandPaletteResults, {
        query,
        clients,
        vault: matchingVaultCommands(
            vaultCommands({ enabled: true, clientId, role: 'admin' }),
            query,
        ).map(command => ({ id: command.id, label: command.label })),
        onSelectClient: () => undefined,
        onSelectVault: () => undefined,
    }));
}

test('typing vault lists the three vault commands and hides the empty state', () => {
    assert.deepEqual(matchingVaultCommands(vaultCommands({ enabled: true, clientId, role: 'admin' }), 'vault').map(item => item.label), [
        'Open Context Vault',
        'Save to vault',
        'Review vault proposals',
    ]);
    assert.equal(commandPaletteShowsEmpty('vault', [0, vault.length]), false);
    const html = render('vault');
    assert.match(html, /Open Context Vault/);
    assert.match(html, /Save to vault/);
    assert.match(html, /Review vault proposals/);
    assert.equal(html.includes('No matches'), false);
});

test('the empty state appears only when every group is empty', () => {
    assert.equal(commandPaletteShowsEmpty('zzzz', [0, 0], 1), false);
    assert.equal(commandPaletteShowsEmpty('zzzz', [0, 0]), true);
    assert.equal(commandPaletteShowsEmpty('va', [1, 0]), false);
    assert.equal(commandPaletteShowsEmpty('v', [0, 0]), false);
    const empty = render('zzzz');
    assert.match(empty, /No matches for (?:&quot;|")zzzz/);
    assert.equal(empty.includes('Context Vault'), false);
    const withClient = render('vault', [{ id: 'c', name: 'Vault Digital', detail: 'Abel · T1 · Monthly' }]);
    assert.match(withClient, /Vault Digital/);
    assert.match(withClient, /Open Context Vault/);
    assert.equal(withClient.includes('No matches'), false);
});
