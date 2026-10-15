import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArchivedClientNotice } from '../../components/workspace/ArchivedClientNotice';
import { ClientActionsMenu, DeleteClientDialog } from '../../components/workspace/ClientActionsMenu';

test('the overview menu offers a destructive delete client action to managers', () => {
    const html = renderToStaticMarkup(createElement(ClientActionsMenu, {
        clientId: 'cbba5b14-7e24-4913-b396-0fff7fb2df17',
        clientName: 'SynBlades',
        canDelete: true,
        onDeleted() {},
        defaultOpen: true,
    }));
    assert.match(html, /aria-label="Client actions"/);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /text-destructive/);
    assert.match(html, />Delete client</);
});

test('viewers do not get a delete action', () => {
    const html = renderToStaticMarkup(createElement(ClientActionsMenu, {
        clientId: 'cbba5b14-7e24-4913-b396-0fff7fb2df17',
        clientName: 'SynBlades',
        canDelete: false,
        onDeleted() {},
        defaultOpen: true,
    }));
    assert.equal(html.includes('Delete client'), false);
    assert.equal(html.includes('role="menu"'), false);
    assert.match(html, /aria-label="Client actions"/);
});

test('delete confirmation names the client and describes the archive', () => {
    const html = renderToStaticMarkup(createElement(DeleteClientDialog, {
        open: true,
        clientName: 'SynBlades',
        busy: false,
        error: null,
        onCancel() {},
        onConfirm() {},
    }));
    assert.match(html, /role="dialog"/);
    assert.match(html, /Delete SynBlades\?/);
    assert.match(html, /archives SynBlades/);
    assert.match(html, /removes it from the active client list/);
    assert.match(html, /Related tasks, time, and other records stay on the archived client/);
    assert.match(html, /bg-destructive/);
    assert.match(html, />Delete client</);
    assert.match(html, />Cancel</);
});

test('the archive notice names the client', () => {
    const html = renderToStaticMarkup(createElement(ArchivedClientNotice, {
        name: 'SynBlades',
        onDismiss() {},
    }));
    assert.match(html, /role="status"/);
    assert.match(html, /SynBlades/);
    assert.match(html, /archived and removed from the active list/);
});

test('the client overview wires delete through the manager check and leaves for the workspace', () => {
    const page = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /ClientActionsMenu/);
    assert.match(page, /canDeleteClient\(membership\?\.role\)/);
    assert.match(page, /archivedClientPath\(name\)/);
    assert.match(page, /notifyClientsChanged\(\)/);
    const list = readFileSync(new URL('../../app/(dashboard)/workspace/page.tsx', import.meta.url), 'utf8');
    assert.match(list, /ArchivedClientNotice/);
    assert.match(list, /readArchivedClientNotice/);
    const hook = readFileSync(new URL('../hooks/use-clients.ts', import.meta.url), 'utf8');
    assert.match(hook, /CLIENTS_CHANGED_EVENT/);
});
