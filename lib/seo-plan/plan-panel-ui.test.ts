import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { PlanSidePanel } from '../../components/seo-plan/PlanSidePanel.tsx';
import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import { applyPlanPanelSave, planPanelTask, type PlanPanelSave } from './plan-panel.ts';
import type { StageListTask } from './stage-list.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    HTMLButtonElement: globalThis.HTMLButtonElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    act: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT,
};
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
const elementPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
elementPrototype.attachEvent ??= () => undefined;
elementPrototype.detachEvent ??= () => undefined;

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

const people = [
    { id: 'miguel', name: 'Miguel R.', initials: 'MR' },
    { id: 'carlos', name: 'Carlos M.', initials: 'CM' },
];

const plan: StageListTask[] = [
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
        assigneeIds: ['miguel'],
        category: 'content',
        status: 'in_progress',
    }),
    task({ id: 'later', title: 'Later backlog', stage: 'backlog', position: 2 }),
];

function key(target: EventTarget, keyName: string) {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: keyName, bubbles: true }));
}

function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    input.focus();
    const prototype = input instanceof dom.window.HTMLTextAreaElement
        ? dom.window.HTMLTextAreaElement.prototype
        : dom.window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent('keyup', { bubbles: true }));
}

function Harness({
    onOpen,
    onClose,
}: {
    onOpen: (id: string, field: string | null) => void;
    onClose: () => void;
}) {
    const [panelId, setPanelId] = useState<string | null>(null);
    const [field, setField] = useState<'title' | 'due' | 'assignee' | null>(null);
    const selected = plan.find(item => item.id === panelId);
    const model = selected ? planPanelTask({
        task: selected,
        tasks: plan,
        detail: {
            id: selected.id,
            description: 'Rewrite the kitchen page.',
            estimatedHours: 2,
            tags: ['content', 'custom-tag'],
            createdBy: 'carlos',
            basecampTodoId: 88,
            basecampProjectId: 48599958,
            lastSyncedAt: '2026-10-20T12:00:00.000Z',
        },
        people,
        accountId: '999',
        basecampListName: 'SEO: October',
        loggedHours: 0.5,
    }) : null;
    return createElement(StagePlanListView, {
        tasks: plan,
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: (id, nextField) => {
            const focus = nextField === 'due' || nextField === 'assignee' ? nextField : null;
            setPanelId(id);
            setField(focus);
            onOpen(id, focus);
        },
        onClosePanel: () => {
            setPanelId(null);
            onClose();
        },
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        clientName: "Maya's Construction",
        today: '2026-10-20',
        initialMonth: '2026-10',
        people,
        panelTaskId: panelId,
        panel: model ? createElement(PlanSidePanel, {
            task: model,
            tasks: plan,
            people,
            clientName: "Maya's Construction",
            today: '2026-10-20',
            now: new Date('2026-10-20T12:02:00.000Z'),
            focusField: field,
            autosaveMs: 40,
            onSave: async () => null,
            onDuplicate: async () => null,
            onDelete: async () => null,
            onClose: () => {
                setPanelId(null);
                onClose();
            },
        }) : null,
    });
}

async function mount(node: React.ReactElement): Promise<Root> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(node); });
    return root;
}

test.after(() => {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.HTMLInputElement = previous.HTMLInputElement;
    globalThis.HTMLTextAreaElement = previous.HTMLTextAreaElement;
    globalThis.HTMLSelectElement = previous.HTMLSelectElement;
    globalThis.HTMLButtonElement = previous.HTMLButtonElement;
    globalThis.Element = previous.Element;
    globalThis.Node = previous.Node;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previous.act;
});

test('title, due, assignee, and enter open the panel, and the list stays usable', async () => {
    const opens: { id: string; field: string | null }[] = [];
    let closed = 0;
    const root = await mount(createElement(Harness, {
        onOpen: (id, field) => { opens.push({ id, field }); },
        onClose: () => { closed += 1; },
    }));
    try {
        assert.equal(document.querySelector('[data-plan-scrim]'), null);
        assert.equal(document.querySelector('[data-plan-panel]'), null);
        const title = document.querySelector('[data-plan-row="kitchen"] [data-plan-open="title"]');
        assert.ok(title instanceof dom.window.HTMLButtonElement);
        await act(async () => { title.click(); });
        assert.equal(document.querySelector('[data-plan-panel]')?.getAttribute('data-plan-width'), '380');
        assert.equal(document.querySelector('[data-plan-scrim]'), null);
        assert.equal(opens.at(-1)?.id, 'kitchen');
        assert.equal(opens.at(-1)?.field, null);
        assert.match(document.body.textContent ?? '', /Entries are edited in Timesheets/);
        assert.doesNotMatch(document.querySelector('[data-seo-plan-stage-list]')?.textContent ?? '', /Basecamp/);

        const due = document.querySelector('[data-plan-row="kickoff"] [data-plan-open="due"]');
        assert.ok(due instanceof dom.window.HTMLButtonElement);
        await act(async () => { due.click(); });
        assert.equal(opens.at(-1)?.field, 'due');
        assert.equal(document.activeElement, document.querySelector('[data-plan-field="due"]'));
        const kickoff = document.querySelector('[data-plan-row="kickoff"] [data-plan-open="title"]');
        assert.ok(kickoff instanceof dom.window.HTMLButtonElement);
        await act(async () => { kickoff.click(); });
        assert.equal(opens.at(-1)?.id, 'kickoff');

        const assignee = document.querySelector('[data-plan-row="kitchen"] [data-plan-open="assignee"]');
        assert.ok(assignee instanceof dom.window.HTMLButtonElement);
        await act(async () => { assignee.click(); });
        assert.equal(opens.at(-1)?.field, 'assignee');
        assert.equal(document.querySelector('[data-plan-menu="assignee"]') instanceof dom.window.HTMLElement, true);
        await act(async () => { key(window, 'Escape'); });
        assert.equal(document.querySelector('[data-plan-panel]'), null);

        for (const id of ['sibling', 'child', 'pillar', 'kickoff']) {
            await act(async () => { key(window, 'k'); });
            assert.equal(document.querySelector('[data-plan-focused="true"]')?.getAttribute('data-plan-row'), id);
        }
        await act(async () => { key(window, 'Enter'); });
        assert.equal(opens.at(-1)?.id, 'kickoff');
        await act(async () => { key(window, 'j'); });
        assert.equal(opens.at(-1)?.id, 'pillar');
        await act(async () => { key(window, 'j'); });
        assert.equal(opens.at(-1)?.id, 'child');
        assert.equal(opens.some(open => open.id === 'later' || open.id === 'done'), false);
        assert.equal(document.querySelector('[data-plan-row="later"]')?.closest('[hidden]') instanceof dom.window.HTMLElement, true);

        const panelTitle = document.querySelector('[data-plan-field="title"]');
        assert.ok(panelTitle instanceof dom.window.HTMLInputElement);
        await act(async () => { key(panelTitle, 'j'); });
        assert.equal((document.querySelector('[data-plan-field="title"]') as HTMLInputElement | null)?.value, 'Fix NAP');
        await act(async () => { key(panelTitle, 'Escape'); });
        assert.ok(document.querySelector('[data-plan-panel]'));
        await act(async () => { key(window, 'Escape'); });
        assert.equal(document.querySelector('[data-plan-panel]'), null);
        assert.ok(closed >= 1);
    } finally {
        await act(async () => { root.unmount(); });
    }
});

test('title and description autosave, and fields save the whole selection', async () => {
    const saves: PlanPanelSave[] = [];
    const kitchen = plan.find(item => item.id === 'kitchen');
    assert.ok(kitchen);
    const model = planPanelTask({
        task: kitchen,
        tasks: plan,
        detail: {
            id: kitchen.id,
            description: 'Rewrite the kitchen page.',
            estimatedHours: 2,
            tags: ['content'],
            createdBy: 'carlos',
            basecampTodoId: null,
            basecampProjectId: null,
            lastSyncedAt: null,
        },
        people,
        loggedHours: 0.5,
    });
    const root = await mount(createElement(PlanSidePanel, {
        task: model,
        tasks: plan,
        people,
        clientName: "Maya's Construction",
        today: '2026-10-20',
        focusField: null,
        autosaveMs: 30,
        onSave: async (_id, save) => {
            saves.push(save);
            return null;
        },
        onDuplicate: async () => null,
        onDelete: async () => null,
        onClose: () => undefined,
    }));
    try {
        const select = document.querySelector('[data-plan-field="status"]');
        assert.ok(select instanceof dom.window.HTMLSelectElement);
        assert.equal(select.getAttribute('data-plan-status-stored'), 'in_progress');
        assert.deepEqual([...select.options].map(option => option.textContent), ['To do', 'In progress', 'Done']);
        assert.doesNotMatch(select.textContent ?? '', /Review|Approved|Blocked/);

        const title = document.querySelector('[data-plan-field="title"]');
        assert.ok(title instanceof dom.window.HTMLInputElement);
        await act(async () => { setValue(title, 'Kitchen remodel'); });
        assert.equal(title.value, 'Kitchen remodel');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
        assert.equal(title.value, 'Kitchen remodel');
        assert.deepEqual(saves.at(-1), { field: 'title', title: 'Kitchen remodel' });

        const description = document.querySelector('[data-plan-field="description"]');
        assert.ok(description instanceof dom.window.HTMLTextAreaElement);
        await act(async () => {
            setValue(description, 'Add the FAQ.');
            description.blur();
        });
        assert.deepEqual(saves.at(-1), { field: 'description', description: 'Add the FAQ.' });

        await act(async () => {
            select.value = 'done';
            select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        assert.deepEqual(saves.at(-1), { field: 'status', status: 'done' });

        const addLabel = document.querySelector('[data-plan-field="labels"]');
        assert.ok(addLabel instanceof dom.window.HTMLButtonElement);
        await act(async () => { addLabel.click(); });
        const technical = [...document.querySelectorAll('[data-plan-menu="labels"] input')].find(node => (
            node.parentElement?.textContent?.includes('Technical')
        ));
        assert.ok(technical instanceof dom.window.HTMLInputElement);
        await act(async () => { technical.click(); });
        const labels = saves.at(-1);
        assert.equal(labels?.field, 'labels');
        if (labels?.field === 'labels') {
            assert.deepEqual(labels.tags.includes('technical') || labels.category === 'technical', true);
            assert.equal(labels.category === 'content' || labels.tags.includes('content'), true);
        }

        const assignee = document.querySelector('[data-plan-field="assignee"]');
        assert.ok(assignee instanceof dom.window.HTMLButtonElement);
        await act(async () => { assignee.click(); });
        const carlos = [...document.querySelectorAll('[data-plan-menu="assignee"] input')].find(node => (
            node.parentElement?.textContent?.includes('Carlos')
        ));
        assert.ok(carlos instanceof dom.window.HTMLInputElement);
        await act(async () => { carlos.click(); });
        const assigned = saves.at(-1);
        assert.equal(assigned?.field, 'assignees');
        if (assigned?.field === 'assignees') assert.deepEqual(assigned.assigneeIds, ['miguel', 'carlos']);
    } finally {
        await act(async () => { root.unmount(); });
    }
});

test('the parent picker stays one level deep', async () => {
    const saves: PlanPanelSave[] = [];
    const child = plan.find(item => item.id === 'child');
    const pillar = plan.find(item => item.id === 'pillar');
    assert.ok(child && pillar);
    const childModel = planPanelTask({
        task: child,
        tasks: plan,
        detail: {
            id: child.id,
            description: '',
            estimatedHours: null,
            tags: [],
            createdBy: null,
            basecampTodoId: null,
            basecampProjectId: null,
            lastSyncedAt: null,
        },
        people,
    });
    const pillarModel = planPanelTask({
        task: pillar,
        tasks: plan,
        detail: {
            id: pillar.id,
            description: '',
            estimatedHours: null,
            tags: [],
            createdBy: null,
            basecampTodoId: null,
            basecampProjectId: null,
            lastSyncedAt: null,
        },
        people,
    });
    const root = await mount(createElement(PlanSidePanel, {
        task: childModel,
        tasks: plan,
        people,
        clientName: "Maya's Construction",
        today: '2026-10-20',
        focusField: null,
        onSave: async (_id, save) => {
            saves.push(save);
            return null;
        },
        onDuplicate: async () => null,
        onDelete: async () => null,
        onClose: () => undefined,
    }));
    try {
        assert.equal(document.querySelector('[data-plan-parent]')?.getAttribute('data-plan-parent'), 'pillar');
        const move = document.querySelector('[data-plan-field="parent"]');
        assert.ok(move instanceof dom.window.HTMLButtonElement);
        await act(async () => { move.click(); });
        const choices = [...document.querySelectorAll('[data-plan-parent-choice]')].map(node => node.getAttribute('data-plan-parent-choice'));
        assert.equal(choices.includes('none'), true);
        assert.equal(choices.includes('kickoff'), true);
        assert.equal(choices.includes('sibling'), false);
        assert.equal(choices.includes('child'), false);
        const kickoff = document.querySelector('[data-plan-parent-choice="kickoff"]');
        assert.ok(kickoff instanceof dom.window.HTMLButtonElement);
        await act(async () => { kickoff.click(); });
        assert.deepEqual(saves.at(-1), { field: 'parent', parentTaskId: 'kickoff' });
    } finally {
        await act(async () => { root.unmount(); });
    }

    const pillarRoot = await mount(createElement(PlanSidePanel, {
        task: pillarModel,
        tasks: plan,
        people,
        clientName: "Maya's Construction",
        today: '2026-10-20',
        focusField: null,
        onSave: async () => null,
        onDuplicate: async () => null,
        onDelete: async () => null,
        onClose: () => undefined,
    }));
    try {
        assert.equal(document.querySelector('[data-plan-pillar]')?.getAttribute('data-plan-pillar'), '2');
        assert.match(document.querySelector('[data-plan-pillar]')?.textContent ?? '', /This is a pillar · 0\/2/);
        assert.equal(document.querySelector('[data-subtask-progress]')?.getAttribute('data-subtask-progress'), '0/2');
        assert.equal(document.querySelector('[data-plan-field="parent"]'), null);
    } finally {
        await act(async () => { pillarRoot.unmount(); });
    }
});

test('Blocked asks for a one-line reason, the chip shows it, and Done clears it', async () => {
    const saves: PlanPanelSave[] = [];
    const source = task({
        id: 'kitchen',
        title: 'Kitchen remodel',
        status: 'in_progress',
        blockedReason: null,
        category: 'content',
        dueDate: '2026-10-17',
    });
    function BlockedHarness() {
        const [tasks, setTasks] = useState<StageListTask[]>([source]);
        const current = tasks[0];
        const model = planPanelTask({
            task: current,
            tasks,
            detail: {
                id: current.id,
                description: '',
                estimatedHours: 2,
                tags: ['content'],
                createdBy: 'carlos',
                basecampTodoId: null,
                basecampProjectId: null,
                lastSyncedAt: null,
            },
        });
        return createElement(StagePlanListView, {
            tasks,
            query: '',
            onQueryChange: () => undefined,
            onOpenTask: () => undefined,
            onAddTasks: async () => undefined,
            onReorder: async () => undefined,
            clientName: "Maya's Construction",
            today: '2026-10-20',
            initialMonth: '2026-10',
            people,
            panelTaskId: current.id,
            panel: createElement(PlanSidePanel, {
                task: model,
                tasks,
                people,
                clientName: "Maya's Construction",
                today: '2026-10-20',
                focusField: null,
                onSave: async (id, save) => {
                    saves.push(save);
                    setTasks(currentTasks => currentTasks.map(item => (
                        item.id === id ? applyPlanPanelSave(item, save, '2026-10-20T12:00:00.000Z') : item
                    )));
                    return null;
                },
                onDuplicate: async () => null,
                onDelete: async () => null,
                onClose: () => undefined,
            }),
        });
    }

    const root = await mount(createElement(BlockedHarness));
    try {
        assert.equal(document.querySelector('[data-plan-row] [data-plan-blocked]'), null);
        const addLabel = document.querySelector('[data-plan-field="labels"]');
        assert.ok(addLabel instanceof dom.window.HTMLButtonElement);
        await act(async () => { addLabel.click(); });
        const addBlocked = document.querySelector('[data-plan-blocked-add]');
        assert.ok(addBlocked instanceof dom.window.HTMLInputElement);
        await act(async () => { addBlocked.click(); });
        const reason = document.querySelector('[data-plan-field="blocked-reason"]');
        assert.ok(reason instanceof dom.window.HTMLInputElement);
        const submit = reason.form?.querySelector('button[type="submit"]');
        assert.ok(submit instanceof dom.window.HTMLButtonElement);
        await act(async () => { submit.click(); });
        assert.match(document.body.textContent ?? '', /Add a one-line reason for the block/);
        assert.equal(saves.length, 0);

        await act(async () => { setValue(reason, 'Waiting on client logins'); });
        await act(async () => {
            submit.click();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        assert.deepEqual(saves.at(-1), { field: 'blocked', blockedReason: 'Waiting on client logins' });
        const panelChip = document.querySelector('[data-plan-panel] [data-plan-blocked]');
        assert.match(panelChip?.textContent ?? '', /Blocked: Waiting on client logins/);
        const rowChip = document.querySelector('[data-plan-row] [data-plan-blocked]');
        assert.equal(rowChip?.textContent, 'Blocked');
        assert.equal(rowChip?.getAttribute('title'), 'Blocked: Waiting on client logins');
        assert.equal(rowChip?.className.includes('text-[#f87171]'), false);

        const remove = document.querySelector('[data-plan-blocked-remove]');
        assert.ok(remove instanceof dom.window.HTMLButtonElement);
        await act(async () => {
            remove.click();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        assert.deepEqual(saves.at(-1), { field: 'blocked', blockedReason: null });
        assert.equal(document.querySelector('[data-plan-blocked]'), null);

        await act(async () => { document.querySelector<HTMLButtonElement>('[data-plan-field="labels"]')?.click(); });
        await act(async () => { document.querySelector<HTMLInputElement>('[data-plan-blocked-add]')?.click(); });
        const again = document.querySelector('[data-plan-field="blocked-reason"]');
        assert.ok(again instanceof dom.window.HTMLInputElement);
        await act(async () => { setValue(again, 'Waiting on the permit'); });
        await act(async () => {
            again.form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        const status = document.querySelector('[data-plan-field="status"]');
        assert.ok(status instanceof dom.window.HTMLSelectElement);
        await act(async () => {
            status.value = 'done';
            status.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        assert.deepEqual(saves.at(-1), { field: 'status', status: 'done' });
        assert.equal(document.querySelector('[data-plan-blocked]'), null);
        await act(async () => { document.querySelector<HTMLButtonElement>('[data-plan-field="labels"]')?.click(); });
        assert.equal(document.querySelector('[data-plan-blocked-add]'), null);
    } finally {
        await act(async () => { root.unmount(); });
    }
});

test('marking an onboarding subtask done names the checkbox and offers Undo before it hides', async () => {
    function CheckHarness() {
        const [tasks, setTasks] = useState(plan);
        return createElement(StagePlanListView, {
            tasks,
            query: '',
            onQueryChange: () => undefined,
            onOpenTask: () => undefined,
            onAddTasks: async () => undefined,
            onReorder: async () => undefined,
            today: '2026-10-20',
            initialMonth: '2026-10',
            clientName: "Maya's Construction",
            doneHoldMs: 60_000,
            onToggleCheck: taskId => {
                setTasks(current => current.map(item => item.id === taskId
                    ? { ...item, status: item.status === 'done' ? 'todo' : 'done' }
                    : item));
            },
        });
    }
    const root = await mount(createElement(CheckHarness));
    try {
        const box = document.querySelector('[data-task-id="child"] [role="checkbox"]');
        assert.ok(box instanceof dom.window.HTMLButtonElement);
        assert.equal(box.getAttribute('aria-checked'), 'false');
        assert.match(box.getAttribute('aria-label') ?? '', /Mark "Fix NAP" done/);
        const space = new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        box.dispatchEvent(space);
        assert.equal(space.defaultPrevented, false);
        await act(async () => { box.click(); });
        const row = document.querySelector('[data-task-id="child"]');
        assert.ok(row);
        assert.match(row.textContent ?? '', /Marked done/);
        assert.match(row.textContent ?? '', /Undo/);
        const checked = row.querySelector('[role="checkbox"]');
        assert.equal(checked?.getAttribute('aria-checked'), 'true');
        const undo = row.querySelector('[data-subtask-undo="child"]');
        assert.ok(undo instanceof dom.window.HTMLButtonElement);
        await act(async () => { undo.click(); });
        const restored = document.querySelector('[data-task-id="child"] [role="checkbox"]');
        assert.equal(restored?.getAttribute('aria-checked'), 'false');
        assert.equal((document.querySelector('[data-task-id="child"]')?.textContent ?? '').includes('Marked done'), false);
    } finally {
        await act(async () => { root.unmount(); });
    }
});
