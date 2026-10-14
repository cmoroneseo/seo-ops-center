import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExecutionWorkspace } from '../../components/marketing-plan/ExecutionWorkspace.tsx';
import { SEO_PLAN_READ_ONLY_NOTE, seoPlanReadOnly } from './read-only.ts';
import type { MarketingPlan } from '../types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('cancelled and archived clients are read-only and everyone else can still schedule', () => {
    assert.equal(seoPlanReadOnly('Cancelled'), true);
    assert.equal(seoPlanReadOnly('Archived'), true);
    for (const status of ['Active', 'Onboarding', 'Paused', '', null]) {
        assert.equal(seoPlanReadOnly(status), false);
    }
    const page = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../../components/dashboard/DashboardShell.tsx', import.meta.url), 'utf8');
    assert.match(page, /readOnly=\{v2On && seoPlanReadOnly\(client\.status\)\}/);
    assert.match(page, /knownAgreements=\{v2On \? client\.agreements \?\? null : null\}/);
    assert.match(shell, /isWorkspace && "\[scrollbar-gutter:stable\]"/);
});

test('a read-only SEO Plan hides Schedule work and Add Item and says why', () => {
    const plan: MarketingPlan = {
        id: 'plan', organizationId: 'org', clientId: 'client', title: 'Plan', goal: 'Rank',
        steps: [], createdAt: '2026-10-01', updatedAt: '2026-10-01', items: [],
    };
    const html = renderToStaticMarkup(createElement(ExecutionWorkspace, {
        plan,
        month: '2026-10',
        budget: 10,
        loggedHours: 0,
        taskHours: {},
        members: [],
        fullPlan: createElement('p', null, 'Roadmap'),
        onAddExisting: () => {},
        onMonthChange: () => {},
        onSaveTask: async () => {},
        onSchedule: async () => {},
        onSaveGoal: async () => {},
        onOpenTask: () => {},
        variant: 'v2',
        phaseMonth: { needsDate: [], due: [], slipped: [] },
        readOnly: true,
    }));
    assert.match(html, new RegExp(SEO_PLAN_READ_ONLY_NOTE));
    assert.equal(html.includes('Schedule work'), false);
    assert.equal(html.includes('Add Item'), false);
    assert.equal(html.includes('>Schedule<'), false);
});

test('an archived pre-launch plan does not invite scheduling in the header', () => {
    const plan: MarketingPlan = {
        id: 'plan', organizationId: 'org', clientId: 'client', title: 'Plan', goal: 'Rank',
        steps: [], createdAt: '2026-10-01', updatedAt: '2026-10-01', items: [],
    };
    const props = {
        plan,
        month: '2026-10',
        budget: 10,
        loggedHours: 0,
        taskHours: {},
        members: [],
        fullPlan: createElement('p', null, 'Roadmap'),
        onAddExisting: () => {},
        onMonthChange: () => {},
        onSaveTask: async () => {},
        onSchedule: async () => {},
        onSaveGoal: async () => {},
        onOpenTask: () => {},
        variant: 'v2' as const,
        hoursNarrative: 'prelaunch' as const,
        phaseMonth: { needsDate: [], due: [], slipped: [] },
    };
    const archived = renderToStaticMarkup(createElement(ExecutionWorkspace, { ...props, readOnly: true }));
    assert.match(archived, new RegExp(SEO_PLAN_READ_ONLY_NOTE));
    assert.equal(archived.includes('Work can be scheduled now'), false);
    assert.equal(archived.includes('These hours start after launch'), false);
    const open = renderToStaticMarkup(createElement(ExecutionWorkspace, { ...props, readOnly: false }));
    assert.match(open, /These hours start after launch/);
    assert.match(open, /Work can be scheduled now/);
});
