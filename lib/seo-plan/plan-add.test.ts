import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PLAN_ADD_CHIP_DEFAULT,
    cyclePlanAddChip,
    endOfMonthDay,
    planAddDestination,
    planAddPreviewMeta,
    planAddPreviewTitle,
    resolvePlanAddMonth,
} from './plan-add.ts';
import { STAGE_ADD_MAX_TITLE_LENGTH, STAGE_ADD_MAX_TITLES, parseStageAddLines } from './stage-add-lines.ts';

test('the due chip cycles end of month, backlog, onboarding, then back', () => {
    assert.equal(PLAN_ADD_CHIP_DEFAULT, 'month');
    assert.equal(cyclePlanAddChip('month'), 'backlog');
    assert.equal(cyclePlanAddChip('backlog'), 'onboarding');
    assert.equal(cyclePlanAddChip('onboarding'), 'month');
});

test('the default chip is the last day of the month, and the other chips carry no date', () => {
    assert.equal(endOfMonthDay('2026-10'), '2026-10-31');
    assert.equal(endOfMonthDay('2026-02'), '2026-02-28');
    assert.equal(endOfMonthDay('2028-02'), '2028-02-29');
    assert.equal(endOfMonthDay('2026-13'), null);
    assert.equal(endOfMonthDay('October'), null);

    const month = planAddDestination('month', '2026-10');
    assert.equal(month.stage, 'backlog');
    assert.equal(month.dueDate, '2026-10-31');
    assert.equal(month.label, 'Due Oct 31');
    assert.equal(month.meta, 'due Oct 31');

    const backlog = planAddDestination('backlog', '2026-10');
    assert.deepEqual(
        { stage: backlog.stage, dueDate: backlog.dueDate, label: backlog.label },
        { stage: 'backlog', dueDate: null, label: 'Backlog no date' },
    );

    const onboarding = planAddDestination('onboarding', '2026-10');
    assert.deepEqual(
        { stage: onboarding.stage, dueDate: onboarding.dueDate, label: onboarding.label },
        { stage: 'onboarding', dueDate: null, label: 'Onboarding' },
    );
});

test('with no month prop the chip uses the current month in the org timezone', () => {
    const evening = new Date('2026-11-01T06:30:00.000Z');
    assert.equal(resolvePlanAddMonth(undefined, evening, 'America/Los_Angeles'), '2026-10');
    assert.equal(resolvePlanAddMonth(undefined, new Date('2026-11-01T08:00:00.000Z'), 'America/Los_Angeles'), '2026-11');
    assert.equal(resolvePlanAddMonth('2026-12', evening), '2026-12');
    assert.equal(resolvePlanAddMonth('nope', evening, 'America/Los_Angeles'), '2026-10');
    assert.equal(resolvePlanAddMonth(undefined, evening, 'Not/AZone'), '2026-10');
});

test('the preview names pillars and blocks batches over the line or title cap', () => {
    const lines = parseStageAddLines('Citations round 2\n  Houzz\n  Porch\n  Thumbtack\nUpdate GBP\nAdd FAQ');
    assert.equal(planAddPreviewTitle(lines).title, 'Add 6 tasks');
    assert.equal(planAddPreviewTitle(lines).canSubmit, true);
    assert.equal(planAddPreviewMeta(lines, 'due Oct 31'), '1 pillar · 3 subtasks · due Oct 31');
    assert.equal(planAddPreviewMeta(parseStageAddLines('One\nTwo'), 'Onboarding'), 'Onboarding');
    assert.equal(planAddPreviewTitle([{ title: 'Only' }]).title, 'Add 1 task');

    const many = Array.from({ length: STAGE_ADD_MAX_TITLES + 1 }, (_, index) => ({ title: `Task ${index}` }));
    assert.equal(planAddPreviewTitle(many).title, 'Add up to 40 tasks at a time.');
    assert.equal(planAddPreviewTitle(many).canSubmit, false);
    const long = [{ title: 'x'.repeat(STAGE_ADD_MAX_TITLE_LENGTH + 1) }, { title: 'Short' }];
    assert.equal(planAddPreviewTitle(long).title, 'Keep each title under 300 characters.');
    assert.equal(planAddPreviewTitle(long).canSubmit, false);
    assert.equal(planAddPreviewTitle([{ title: 'x'.repeat(STAGE_ADD_MAX_TITLE_LENGTH) }]).canSubmit, true);
});
