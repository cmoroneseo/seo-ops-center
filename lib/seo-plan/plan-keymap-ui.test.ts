import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLButtonElement: globalThis.HTMLButtonElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    navigator: globalThis.navigator,
    act: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT,
};
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const elementPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
elementPrototype.attachEvent ??= () => undefined;
elementPrototype.detachEvent ??= () => undefined;

import type { StageListTask } from './stage-list.ts';
import type { StagePlanListView as StagePlanListViewComponent } from '../../components/seo-plan/StagePlanListView.tsx';

type Root = import('react-dom/client').Root;
let act: typeof import('react').act;
let createElement: typeof import('react').createElement;
let useState: typeof import('react').useState;
let createRoot: typeof import('react-dom/client').createRoot;
let StagePlanListView: typeof StagePlanListViewComponent;
let planCheckStatus: typeof import('./plan-keymap.ts').planCheckStatus;

async function ensureLoaded(): Promise<void> {
    if (act) return;
    const React = await import('react');
    const reactDom = await import('react-dom/client');
    const view = await import('../../components/seo-plan/StagePlanListView.tsx');
    const keymap = await import('./plan-keymap.ts');
    (globalThis as { React: typeof React }).React = React;
    act = React.act;
    createElement = React.createElement;
    useState = React.useState;
    createRoot = reactDom.createRoot;
    StagePlanListView = view.StagePlanListView;
    planCheckStatus = keymap.planCheckStatus;
}

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'backlog',
        position: null,
        parentTaskId: null,
        createdAt: '2026-10-02T15:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const seed: StageListTask[] = [
    task({ id: 'kickoff', title: 'Kickoff call recap', stage: 'onboarding', position: 1 }),
    task({ id: 'done', title: 'Finished onboarding', stage: 'onboarding', position: 2, status: 'done' }),
    task({ id: 'pillar', title: 'Citations cleanup', stage: 'onboarding', position: 3 }),
    task({ id: 'child', title: 'Fix NAP', stage: 'onboarding', position: 1, parentTaskId: 'pillar' }),
    task({ id: 'sibling', title: 'Other citation', stage: 'onboarding', position: 2, parentTaskId: 'pillar' }),
    task({
        id: 'kitchen',
        title: 'Service page refresh: Kitchen remodeling',
        stage: 'backlog',
        position: 1,
        dueDate: '2026-10-17',
        status: 'in_progress',
        blockedReason: 'Waiting on the client',
    }),
    task({ id: 'later', title: 'Later backlog', stage: 'backlog', position: 2 }),
];

function key(target: EventTarget, keyName: string, init: KeyboardEventInit = {}) {
    const event = new dom.window.KeyboardEvent('keydown', {
        key: keyName,
        bubbles: true,
        cancelable: true,
        ...init,
    });
    target.dispatchEvent(event);
    return event;
}

function setValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function paste(input: HTMLInputElement, text: string) {
    const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => (type === 'text' || type === 'text/plain' ? text : '') },
    });
    input.dispatchEvent(event);
}

function focusedRow(): string | null {
    return document.querySelector('[data-plan-focused="true"]')?.getAttribute('data-plan-row') ?? null;
}

function rowUrl(taskId: string): HTMLInputElement | null {
    const found = document.querySelector(
        `[data-plan-row="${taskId}"] input[aria-label="Live URL"], [data-plan-row="${taskId}"] input[aria-label="Edit live URL"]`,
    );
    return found instanceof dom.window.HTMLInputElement ? found : null;
}

function addInput(): HTMLInputElement {
    const found = document.querySelector('[data-plan-add]');
    assert.ok(found instanceof dom.window.HTMLInputElement);
    return found;
}

function searchInput(): HTMLInputElement {
    const found = document.querySelector('[data-plan-search]');
    assert.ok(found instanceof dom.window.HTMLInputElement);
    return found;
}

function Harness({
    onOpen,
    onClose,
    onAdd,
    onTimer,
    checks,
}: {
    onOpen: (id: string) => void;
    onClose: () => void;
    onAdd: () => void;
    onTimer: (id: string) => void;
    checks: string[];
}) {
    const [tasks, setTasks] = useState(seed);
    const [query, setQuery] = useState('');
    const [panelId, setPanelId] = useState<string | null>(null);
    return createElement(StagePlanListView, {
        tasks,
        query,
        onQueryChange: setQuery,
        onOpenTask: (id) => {
            setPanelId(id);
            onOpen(id);
        },
        onClosePanel: () => {
            setPanelId(null);
            onClose();
        },
        onAddTasks: async () => { onAdd(); },
        onReorder: async () => undefined,
        onSetLiveUrl: async () => null,
            onToggleCheck: (id) => {
            checks.push(id);
            setTasks(current => current.map(item => (
                item.id === id
                    ? {
                        ...item,
                        status: planCheckStatus(item.status),
                        completedAt: item.status === 'done' ? null : '2026-10-20T12:00:00.000Z',
                        blockedReason: item.status === 'done' ? item.blockedReason : null,
                    }
                    : item
            )));
        },
        onRowTimer: onTimer,
        today: '2026-10-20',
        initialMonth: '2026-10',
        panelTaskId: panelId,
    });
}

async function mount(): Promise<{ root: Root; opens: string[]; closes: number[]; adds: number[]; timers: string[]; checks: string[] }> {
    await ensureLoaded();
    document.body.replaceChildren();
    const opens: string[] = [];
    const closes: number[] = [];
    const adds: number[] = [];
    const timers: string[] = [];
    const checks: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(createElement(Harness, {
            onOpen: id => { opens.push(id); },
            onClose: () => { closes.push(1); },
            onAdd: () => { adds.push(1); },
            onTimer: id => { timers.push(id); },
            checks,
        }));
    });
    return { root, opens, closes, adds, timers, checks };
}

test.after(() => {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.HTMLInputElement = previous.HTMLInputElement;
    globalThis.HTMLButtonElement = previous.HTMLButtonElement;
    globalThis.Element = previous.Element;
    globalThis.Node = previous.Node;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previous.act;
});

test('each plan shortcut acts once, and brackets step a single month', async () => {
    const { root, opens, closes, timers, checks } = await mount();
    try {
        assert.equal(document.querySelector('[data-plan-month]')?.getAttribute('data-plan-month'), '2026-10');
        await act(async () => { key(window, ']'); });
        assert.equal(document.querySelector('[data-plan-month]')?.getAttribute('data-plan-month'), '2026-11');
        await act(async () => { key(window, '['); });
        assert.equal(document.querySelector('[data-plan-month]')?.getAttribute('data-plan-month'), '2026-10');
        await act(async () => { key(window, '['); });
        assert.equal(document.querySelector('[data-plan-month]')?.getAttribute('data-plan-month'), '2026-09');
        await act(async () => { key(window, ']'); });

        await act(async () => { key(window, 'c'); });
        assert.equal(document.activeElement, addInput());
        addInput().blur();

        await act(async () => { key(window, '/'); });
        assert.equal(document.activeElement, searchInput());
        searchInput().blur();

        await act(async () => { key(window, 'j'); });
        assert.equal(focusedRow(), 'kickoff');
        const row = document.querySelector('[data-plan-focused="true"]');
        assert.match(row?.className ?? '', /bg-\[#1d1d22\]/);
        assert.match(row?.className ?? '', /inset_2px_0_0_0_#ec4899/);
        await act(async () => { key(window, 'j'); });
        assert.equal(focusedRow(), 'pillar');
        await act(async () => { key(window, 'k'); });
        assert.equal(focusedRow(), 'kickoff');

        for (const id of ['pillar', 'child', 'sibling', 'kitchen']) {
            await act(async () => { key(window, 'j'); });
            assert.equal(focusedRow(), id);
        }
        assert.ok(document.querySelector('[data-plan-row="kitchen"] [data-plan-blocked]'));
        await act(async () => { key(window, 'x'); });
        assert.deepEqual(checks, ['kitchen']);
        assert.equal(document.querySelector('[data-plan-row="kitchen"] [data-plan-check]')?.getAttribute('data-plan-check'), 'done');
        assert.equal(document.querySelector('[data-plan-row="kitchen"] [data-plan-blocked]'), null);
        await act(async () => { key(window, 'x'); });
        assert.deepEqual(checks, ['kitchen', 'kitchen']);
        assert.equal(document.querySelector('[data-plan-row="kitchen"] [data-plan-check]')?.getAttribute('data-plan-check'), 'open');

        const check = document.querySelector('[data-plan-row="kitchen"] [data-plan-check]');
        assert.ok(check instanceof dom.window.HTMLButtonElement);
        await act(async () => { check.click(); });
        assert.deepEqual(checks, ['kitchen', 'kitchen', 'kitchen']);
        await act(async () => { check.click(); });
        assert.equal(document.querySelector('[data-plan-row="kitchen"] [data-plan-check]')?.getAttribute('data-plan-check'), 'open');

        for (let step = 0; step < 3; step += 1) await act(async () => { key(window, 'k'); });
        assert.equal(focusedRow(), 'pillar');
        await act(async () => { key(window, 'u'); });
        const url = rowUrl('pillar');
        assert.ok(url instanceof dom.window.HTMLInputElement);
        await act(async () => { key(url, 'Escape'); });
        assert.equal(rowUrl('pillar'), null);

        const toggle = document.querySelector('[data-plan-row="pillar"] button[aria-expanded]');
        assert.equal(toggle?.getAttribute('aria-expanded'), 'true');
        await act(async () => { key(window, 'ArrowLeft'); });
        assert.equal(document.querySelector('[data-plan-row="pillar"] button[aria-expanded]')?.getAttribute('aria-expanded'), 'false');
        assert.equal(document.querySelector('[data-plan-row="child"]'), null);
        await act(async () => { key(window, 'ArrowRight'); });
        assert.equal(document.querySelector('[data-plan-row="pillar"] button[aria-expanded]')?.getAttribute('aria-expanded'), 'true');
        assert.ok(document.querySelector('[data-plan-row="child"]'));
        await act(async () => { key(window, 'ArrowRight'); });
        assert.equal(document.querySelector('[data-plan-row="child"]') instanceof dom.window.HTMLElement, true);

        await act(async () => { key(window, 't'); });
        assert.deepEqual(timers, ['pillar']);
        await act(async () => { key(window, 't'); });
        assert.deepEqual(timers, ['pillar', 'pillar']);
        const commandTimer = await act(async () => key(window, 't', { metaKey: true, shiftKey: true }));
        assert.equal(commandTimer.defaultPrevented, false);
        assert.deepEqual(timers, ['pillar', 'pillar']);
        const commandSearch = await act(async () => key(window, 'k', { metaKey: true }));
        assert.equal(commandSearch.defaultPrevented, false);
        assert.equal(focusedRow(), 'pillar');

        await act(async () => { key(window, 'Enter'); });
        assert.equal(opens.at(-1), 'pillar');
        await act(async () => { key(window, 'j'); });
        assert.equal(opens.at(-1), 'child');
        assert.equal(focusedRow(), 'child');
        await act(async () => { key(window, 'Escape'); });
        assert.equal(closes.length, 1);

        await act(async () => { key(window, '?'); });
        const sheet = document.querySelector('[data-plan-shortcuts]');
        assert.equal(sheet?.getAttribute('role'), 'dialog');
        assert.match(sheet?.textContent ?? '', /Focus Add task/);
        assert.match(sheet?.textContent ?? '', /Check or uncheck/);
        assert.match(sheet?.textContent ?? '', /Start or pause the timer/);
        assert.match(sheet?.textContent ?? '', /Previous and next month/);
        assert.equal(focusedRow(), 'child');
        await act(async () => { key(window, 'j'); });
        assert.equal(focusedRow(), 'child');
        await act(async () => { key(window, 'Escape'); });
        assert.equal(document.querySelector('[data-plan-shortcuts]'), null);
        await act(async () => { key(window, '?'); });
        const close = document.querySelector('[aria-label="Close shortcuts"]');
        assert.ok(close instanceof dom.window.HTMLButtonElement);
        await act(async () => { close.click(); });
        assert.equal(document.querySelector('[data-plan-shortcuts]'), null);
    } finally {
        await act(async () => { root.unmount(); });
    }
});

test('shortcuts stay off in text fields, and escape still runs the field', async () => {
    const { root, adds, checks, opens } = await mount();
    try {
        await act(async () => { key(window, 'j'); });
        assert.equal(focusedRow(), 'kickoff');
        const month = document.querySelector('[data-plan-month]')?.getAttribute('data-plan-month');

        await act(async () => { key(window, 'c'); });
        const add = addInput();
        for (const name of ['c', 'j', 'k', 'x', 'u', 't', '/', '[', ']', '?', 'ArrowLeft', 'ArrowRight']) {
            await act(async () => { key(add, name, name === '?' ? { shiftKey: true } : {}); });
        }
        assert.equal(document.activeElement, add);
        assert.equal(focusedRow(), 'kickoff');
        assert.deepEqual(checks, []);
        assert.equal(document.querySelector('[data-plan-month]')?.getAttribute('data-plan-month'), month);
        assert.equal(document.querySelector('[data-plan-shortcuts]'), null);
        assert.equal(document.querySelector('[data-live-url] input'), null);

        await act(async () => { key(add, 'Tab'); });
        assert.equal(document.querySelector('[data-plan-add-chip]')?.getAttribute('data-plan-add-chip'), 'backlog');
        const liveAdd = addInput();
        await act(async () => { setValue(liveAdd, 'Write the kitchen page'); });
        await act(async () => { key(liveAdd, 'Enter'); });
        assert.equal(adds.length, 1);
        assert.deepEqual(opens, []);

        await act(async () => {
            paste(add, 'Citations\n  Yelp\n  BBB');
        });
        assert.ok(document.querySelector('[data-plan-add-preview]'));
        await act(async () => { key(add, 'Escape'); });
        assert.equal(document.querySelector('[data-plan-add-preview]'), null);
        assert.equal(adds.length, 1);

        const chip = document.querySelector('[data-plan-add-chip]');
        assert.ok(chip instanceof dom.window.HTMLButtonElement);
        await act(async () => { chip.click(); });
        assert.ok(document.querySelector('[data-plan-add-option="onboarding"]'));
        await act(async () => { key(chip, 'Escape'); });
        assert.equal(document.querySelector('[data-plan-add-option="onboarding"]'), null);

        const search = searchInput();
        await act(async () => {
            search.focus();
            setValue(search, 'kick');
        });
        assert.equal(search.value, 'kick');
        await act(async () => { key(search, 'j'); });
        assert.equal(focusedRow(), 'kickoff');
        await act(async () => { key(search, 'x'); });
        assert.deepEqual(checks, []);
        await act(async () => { key(search, 'Escape'); });
        assert.equal(searchInput().value, '');
        assert.notEqual(document.activeElement, searchInput());

        await act(async () => { key(window, 'j'); });
        await act(async () => { key(window, 'u'); });
        const url = rowUrl('pillar');
        assert.ok(url instanceof dom.window.HTMLInputElement);
        const before = checks.length;
        await act(async () => { key(url, 'x'); });
        assert.equal(checks.length, before);
        await act(async () => { key(url, 'Escape'); });
        assert.equal(rowUrl('pillar'), null);
    } finally {
        await act(async () => { root.unmount(); });
    }
});

test('escape clears a search that is not focused, after the panel is closed', async () => {
    const { root, closes } = await mount();
    try {
        const search = searchInput();
        await act(async () => {
            search.focus();
            setValue(search, 'kitchen');
        });
        assert.equal(searchInput().value, 'kitchen');
        await act(async () => { key(window, 'j'); });
        await act(async () => { key(window, 'Enter'); });
        await act(async () => { key(window, 'Escape'); });
        assert.equal(closes.length, 1);
        assert.equal(searchInput().value, 'kitchen');
        await act(async () => { key(window, 'Escape'); });
        assert.equal(searchInput().value, '');
    } finally {
        await act(async () => { root.unmount(); });
    }
});
