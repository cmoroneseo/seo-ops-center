import test from 'node:test';
import assert from 'node:assert/strict';
import { SEO_PLAN_SANDBOX_ORG_ID, seoPlanStageListEnabled, seoPlanV2Enabled } from './flags.ts';

const OTHER = '11111111-1111-4111-8111-111111111111';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
}

test('SEO Plan v2 stays off unless the flag is exactly true and the org is allowlisted', () => {
    assert.equal(seoPlanV2Enabled(env({}), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanV2Enabled(env({ SEO_PLAN_V2: '1' }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanV2Enabled(env({ SEO_PLAN_V2: 'TRUE', SEO_PLAN_V2_ORG_IDS: SEO_PLAN_SANDBOX_ORG_ID }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanV2Enabled(env({ SEO_PLAN_V2: 'true' }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanV2Enabled(env({ SEO_PLAN_V2: 'true', SEO_PLAN_V2_ORG_IDS: '' }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanV2Enabled(env({ SEO_PLAN_V2: 'true', SEO_PLAN_V2_ORG_IDS: 'nope' }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanV2Enabled(env({
        SEO_PLAN_V2: 'true',
        SEO_PLAN_V2_ORG_IDS: ` ${SEO_PLAN_SANDBOX_ORG_ID.toUpperCase()} , not-a-uuid `,
    }), SEO_PLAN_SANDBOX_ORG_ID), true);
    assert.equal(seoPlanV2Enabled(env({
        SEO_PLAN_V2: 'true',
        SEO_PLAN_V2_ORG_IDS: SEO_PLAN_SANDBOX_ORG_ID,
    }), OTHER), false);
    assert.equal(seoPlanV2Enabled(env({
        SEO_PLAN_V2: 'true',
        SEO_PLAN_V2_ORG_IDS: SEO_PLAN_SANDBOX_ORG_ID,
    })), false);
});

test('the stage list stays off unless its own flag is exactly true and the org is allowlisted', () => {
    assert.equal(seoPlanStageListEnabled(env({}), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanStageListEnabled(env({ SEO_PLAN_STAGE_LIST: '1' }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanStageListEnabled(env({
        SEO_PLAN_STAGE_LIST: 'TRUE',
        SEO_PLAN_STAGE_LIST_ORG_IDS: SEO_PLAN_SANDBOX_ORG_ID,
    }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanStageListEnabled(env({ SEO_PLAN_STAGE_LIST: 'true' }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanStageListEnabled(env({
        SEO_PLAN_STAGE_LIST: 'true',
        SEO_PLAN_STAGE_LIST_ORG_IDS: '',
    }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanStageListEnabled(env({
        SEO_PLAN_STAGE_LIST: 'true',
        SEO_PLAN_STAGE_LIST_ORG_IDS: 'nope',
    }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanStageListEnabled(env({
        SEO_PLAN_V2: 'true',
        SEO_PLAN_V2_ORG_IDS: SEO_PLAN_SANDBOX_ORG_ID,
    }), SEO_PLAN_SANDBOX_ORG_ID), false);
    assert.equal(seoPlanStageListEnabled(env({
        SEO_PLAN_STAGE_LIST: 'true',
        SEO_PLAN_STAGE_LIST_ORG_IDS: ` ${SEO_PLAN_SANDBOX_ORG_ID.toUpperCase()} , not-a-uuid `,
    }), SEO_PLAN_SANDBOX_ORG_ID), true);
    assert.equal(seoPlanStageListEnabled(env({
        SEO_PLAN_STAGE_LIST: 'true',
        SEO_PLAN_STAGE_LIST_ORG_IDS: SEO_PLAN_SANDBOX_ORG_ID,
    }), OTHER), false);
    assert.equal(seoPlanStageListEnabled(env({
        SEO_PLAN_STAGE_LIST: 'true',
        SEO_PLAN_STAGE_LIST_ORG_IDS: SEO_PLAN_SANDBOX_ORG_ID,
    })), false);
});
