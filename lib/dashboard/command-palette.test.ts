import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import React, { act, createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandPaletteResults, commandPaletteShowsEmpty } from '../../components/dashboard/CommandPaletteResults.tsx';
import { escapeLikePattern, searchCommandResults } from './command-palette';
import { searchOrgProjectsAndTasks } from '../supabase/global-search';
import { matchingVaultCommands, vaultCommands } from '../vault/commands.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const clientId = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';
const vault = vaultCommands({ enabled: true, clientId, role: 'admin' }).map(command => ({
    id: command.id,
    label: command.label,
}));

function palette(query: string, clients: { id: string; name: string; detail: string }[] = [], props: Partial<ComponentProps<typeof CommandPaletteResults>> = {}) {
    return createElement(CommandPaletteResults, {
        query,
        clients,
        vault: matchingVaultCommands(
            vaultCommands({ enabled: true, clientId, role: 'admin' }),
            query,
        ).map(command => ({ id: command.id, label: command.label })),
        onSelectClient: () => undefined,
        onSelectVault: () => undefined,
        ...props,
    });
}

function render(query: string, clients: { id: string; name: string; detail: string }[] = []) {
    return renderToStaticMarkup(palette(query, clients));
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

test('quick links go to the personal task queue and reports', () => {
    const html = render('');
    assert.match(html, /href="\/tasks\?filter=mine"[^>]*>.*My Tasks/);
    assert.match(html, /href="\/reports"[^>]*>.*Reports/);
});

const project = { id: 'project', clientId, title: 'City Pages', clientName: 'Acme', statusLabel: 'Planned' };
const task = { id: 'task & review', clientId: null, title: 'Review Pages', clientName: null, statusLabel: 'In progress' };
const items = searchCommandResults({ projects: [project], tasks: [task] });

test('search hits link to the project detail and encoded task modal route', () => {
    assert.equal(items.projects[0].href, `/workspace/${clientId}?tab=projects&projectId=project`);
    assert.equal(items.tasks[0].href, '/tasks?task=task%20%26%20review');
});

test('project and task sections show details and invoke their callbacks', async () => {
    const { window } = new JSDOM('<div id="root"></div>');
    Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const container = window.document.getElementById('root')!;
    const root = createRoot(container);
    const selected: string[] = [];
    try {
        await act(async () => root.render(palette('pages', [], {
            ...items,
            onSelectProject: item => { selected.push(item.id); },
            onSelectTask: item => { selected.push(item.id); },
        })));
        assert.deepEqual([...container.querySelectorAll('h3')].map(heading => heading.textContent), ['Projects', 'Tasks']);
        const [projectButton, taskButton] = container.querySelectorAll('button');
        assert.match(projectButton.textContent!, /City Pages.*Acme · Planned.*Jump to/);
        assert.match(taskButton.textContent!, /Review Pages.*In progress.*Jump to/);
        assert.doesNotMatch(container.textContent!, /No matches/);
        await act(async () => { projectButton.click(); taskButton.click(); });
        assert.deepEqual(selected, [project.id, task.id]);
    } finally {
        await act(async () => root.unmount());
        window.close();
        Reflect.deleteProperty(globalThis, 'window');
        Reflect.deleteProperty(globalThis, 'document');
    }
});

test('pending project and task search suppresses the empty state', () => {
    assert.doesNotMatch(renderToStaticMarkup(palette('pages', [], { searchPending: true })), /No matches/);
    assert.equal(commandPaletteShowsEmpty(' a ', [0, 0, 0, 0]), false);
});

test('LIKE patterns escape percent, underscore and backslash', () => {
    assert.equal(escapeLikePattern(String.raw`a%_\b`), String.raw`a\%\_\\b`);
});

test('organization search skips short queries and applies scoped REST filters', async (t) => {
    const requests: URL[] = [];
    const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const oldKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://search-test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key';
    t.after(() => {
        if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
        if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldKey;
    });
    t.mock.method(globalThis, 'fetch', async (input: URL | string) => {
        const url = new URL(input);
        requests.push(url);
        const rows = url.pathname.endsWith('/campaign_initiatives')
            ? [
                { id: project.id, title: project.title, client_id: clientId, state: 'unknown', clients: { name: 'Acme' } },
                { id: 'invalid', title: null, client_id: null, state: 'planned', clients: null },
            ]
            : [{ id: task.id, title: task.title, client_id: null, status: 'in_progress', clients: null }];
        return Response.json(rows);
    });

    assert.deepEqual(await searchOrgProjectsAndTasks('org', ' p '), { projects: [], tasks: [] });
    assert.deepEqual(await searchOrgProjectsAndTasks('', 'pages'), { projects: [], tasks: [] });
    assert.equal(requests.length, 0);
    assert.deepEqual(await searchOrgProjectsAndTasks('org', '  p_%  '), { projects: [project], tasks: [task] });
    assert.equal(requests.length, 2);
    for (const request of requests) {
        assert.equal(request.searchParams.get('organization_id'), 'eq.org');
        assert.equal(request.searchParams.get('title'), String.raw`ilike.%p\_\%%`);
        assert.equal(request.searchParams.get('limit'), '6');
        assert.match(request.searchParams.get('select')!, /clients\(name\)/);
    }
    assert.equal(requests.find(url => url.pathname.endsWith('/tasks'))?.searchParams.get('parent_task_id'), 'is.null');
});
