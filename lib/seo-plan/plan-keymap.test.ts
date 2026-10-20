import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PLAN_KEYMAP,
    planCheckStatus,
    planKeymapAction,
    planKeyTarget,
    type PlanKeymapInput,
} from './plan-keymap.ts';

const ids = ['kickoff', 'pillar', 'kitchen'];

function input(overrides: Partial<PlanKeymapInput> = {}): PlanKeymapInput {
    return {
        key: 'c',
        blocked: false,
        panelOpen: false,
        focusedId: 'kitchen',
        visibleIds: ids,
        hasQuery: false,
        helpOpen: false,
        ...overrides,
    };
}

test('the sheet lists every shortcut in the map', () => {
    const text = PLAN_KEYMAP.map(item => `${item.keys} ${item.label}`).join('\n');
    for (const keys of ['c', '↵', 'Tab', 'Esc', 'j', 'k', 'x', 't', 'u', '/', '[', ']', '→', '←', '?']) {
        assert.match(text, new RegExp(keys.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('checking a row flips done and to do', () => {
    assert.equal(planCheckStatus('todo'), 'done');
    assert.equal(planCheckStatus('in_progress'), 'done');
    assert.equal(planCheckStatus('done'), 'todo');
});

test('c, slash, brackets, and question mark', () => {
    assert.equal(planKeymapAction(input({ key: 'c' })).type, 'focus-add');
    assert.equal(planKeymapAction(input({ key: '/' })).type, 'focus-search');
    assert.deepEqual(planKeymapAction(input({ key: '[' })), { type: 'shift-month', delta: -1 });
    assert.deepEqual(planKeymapAction(input({ key: ']' })), { type: 'shift-month', delta: 1 });
    assert.equal(planKeymapAction(input({ key: '?' })).type, 'help');
    assert.equal(planKeymapAction(input({ key: '/', shiftKey: true })).type, 'help');
});

test('j and k move the row, and an open panel follows', () => {
    assert.deepEqual(planKeymapAction(input({ key: 'j', focusedId: null })), {
        type: 'move',
        taskId: 'kickoff',
        panel: false,
    });
    assert.deepEqual(planKeymapAction(input({ key: 'k', focusedId: 'pillar', panelOpen: false })), {
        type: 'move',
        taskId: 'kickoff',
        panel: false,
    });
    assert.deepEqual(planKeymapAction(input({ key: 'j', focusedId: 'pillar', panelOpen: true })), {
        type: 'move',
        taskId: 'kitchen',
        panel: true,
    });
    assert.deepEqual(planKeymapAction(input({ key: 'Enter', focusedId: 'kitchen' })), {
        type: 'open',
        taskId: 'kitchen',
    });
});

test('x, u, and t act on the focused visible row', () => {
    assert.deepEqual(planKeymapAction(input({ key: 'x' })), { type: 'check', taskId: 'kitchen' });
    assert.deepEqual(planKeymapAction(input({ key: 'u' })), { type: 'url', taskId: 'kitchen' });
    assert.deepEqual(planKeymapAction(input({ key: 't' })), { type: 'timer', taskId: 'kitchen' });
    assert.equal(planKeymapAction(input({ key: 'x', focusedId: null })).type, 'none');
    assert.equal(planKeymapAction(input({ key: 'u', focusedId: 'hidden' })).type, 'none');
    assert.equal(planKeymapAction(input({ key: 't', focusedId: 'hidden' })).type, 'none');
});

test('arrow keys expand and collapse only a focused pillar', () => {
    assert.deepEqual(planKeymapAction(input({ key: 'ArrowRight', pillar: 'collapsed' })), {
        type: 'pillar',
        taskId: 'kitchen',
        expand: true,
    });
    assert.deepEqual(planKeymapAction(input({ key: 'ArrowLeft', pillar: 'expanded' })), {
        type: 'pillar',
        taskId: 'kitchen',
        expand: false,
    });
    assert.equal(planKeymapAction(input({ key: 'ArrowRight', pillar: 'expanded' })).type, 'none');
    assert.equal(planKeymapAction(input({ key: 'ArrowLeft', pillar: 'collapsed' })).type, 'none');
    assert.equal(planKeymapAction(input({ key: 'ArrowLeft', pillar: null })).type, 'none');
    assert.equal(planKeymapAction(input({ key: 'ArrowRight', focusedId: null, pillar: 'collapsed' })).type, 'none');
});

test('escape closes the sheet, clears search, and leaves owned fields alone', () => {
    assert.equal(planKeymapAction(input({ key: 'Escape', helpOpen: true })).type, 'close-help');
    assert.equal(planKeymapAction(input({ key: '?', helpOpen: true })).type, 'close-help');
    assert.equal(planKeymapAction(input({ key: 'j', helpOpen: true })).type, 'swallow');
    assert.equal(planKeymapAction(input({ key: 'Tab', helpOpen: true })).type, 'none');
    assert.equal(planKeymapAction(input({ key: 'Escape', inSearch: true, blocked: true, hasQuery: true })).type, 'clear-search');
    assert.equal(planKeymapAction(input({ key: 'Escape', hasQuery: true, panelOpen: false })).type, 'clear-search');
    assert.equal(planKeymapAction(input({ key: 'Escape', hasQuery: true, panelOpen: true })).type, 'close');
    assert.equal(planKeymapAction(input({ key: 'Escape', escapeOwned: true, panelOpen: true, hasQuery: true })).type, 'none');
    assert.equal(planKeymapAction(input({ key: 'Escape', blocked: true, panelOpen: true })).type, 'none');
    assert.equal(planKeymapAction(input({ key: 'Escape', panelOpen: true })).type, 'close');
    assert.equal(planKeymapAction(input({ key: 'Escape' })).type, 'none');
});

test('single-key shortcuts stay off inside a text field', () => {
    const keys = ['c', 'j', 'k', 'x', 'u', 't', '/', '[', ']', 'ArrowRight', 'ArrowLeft', '?', 'Enter', 'C', 'X'];
    for (const key of keys) {
        assert.equal(planKeymapAction(input({
            key,
            blocked: true,
            shiftKey: key === '?',
            pillar: 'expanded',
            hasQuery: true,
            panelOpen: true,
        })).type, 'none', key);
    }
    assert.equal(planKeymapAction(input({ key: 'Escape', blocked: true, hasQuery: true })).type, 'none');
});

test('command shortcuts are left for the global timer and search', () => {
    assert.equal(planKeymapAction(input({ key: 't', modified: true, shiftKey: true })).type, 'none');
    assert.equal(planKeymapAction(input({ key: 'k', modified: true })).type, 'none');
    assert.equal(planKeymapAction(input({ key: 'c', modified: true })).type, 'none');
});

test('the search field and the add line, URL field, and menus own escape', () => {
    const search = { closest: (selector: string) => (selector === '[data-plan-search]' ? {} : null) };
    assert.deepEqual(planKeyTarget(search as unknown as EventTarget), { inSearch: true, escapeOwned: false });
    const add = { closest: (selector: string) => (selector.includes('data-plan-add-root') ? {} : null) };
    assert.equal(planKeyTarget(add as unknown as EventTarget).escapeOwned, true);
    const url = { closest: (selector: string) => (selector.includes('data-live-url') ? {} : null) };
    assert.equal(planKeyTarget(url as unknown as EventTarget).escapeOwned, true);
    const menu = { closest: (selector: string) => (selector.includes('data-plan-menu') ? {} : null) };
    assert.equal(planKeyTarget(menu as unknown as EventTarget).escapeOwned, true);
    assert.deepEqual(planKeyTarget(null), { inSearch: false, escapeOwned: false });
});
