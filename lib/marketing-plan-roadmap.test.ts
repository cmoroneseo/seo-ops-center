import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isInRoadmap, roadmapItemsForPhase } from './marketing-plan-roadmap';
import { itemsEligibleForTaskGeneration } from './marketing-plan-logic';
import type { MarketingPlanItem } from './types';
const item = (patch: Partial<MarketingPlanItem> = {}) => ({ id: 'item', status: 'todo', ...patch } as MarketingPlanItem);
describe('roadmap scope', () => {
    it('preserves legacy inclusion without coupling modern inclusion to completion', () => {
        assert.equal(isInRoadmap(item()), true);
        assert.equal(isInRoadmap(item({ status: 'ignored' })), false);
        assert.equal(isInRoadmap(item({ status: 'done', roadmapIncluded: false })), false);
    });
    it('groups relative launch phases without using calendar due dates', () => {
        const preparation = item({ roadmapIncluded: true, roadmapPhase: 'onboarding', dueDate: '2026-11-01' });
        const excluded = item({ roadmapIncluded: false, roadmapPhase: 'onboarding' });
        assert.deepEqual(roadmapItemsForPhase([preparation, excluded], 'onboarding'), [preparation]);
        assert.equal(roadmapItemsForPhase([item()], 'backlog').length, 1);
    });
    it('never creates tasks from excluded or already linked work', () => {
        assert.deepEqual(itemsEligibleForTaskGeneration([item({ roadmapIncluded: false }), item({ taskId: 'task' }), item({ id: 'included', roadmapIncluded: true })]).map(i => i.id), ['included']);
    });
});
