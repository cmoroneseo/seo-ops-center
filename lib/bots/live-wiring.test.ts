import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the bot and the UI call the same Basecamp push and timesheet handlers', () => {
    const pushRoute = readFileSync(new URL('../../app/api/integrations/basecamp/push/route.ts', import.meta.url), 'utf8');
    const timesheetRoute = readFileSync(new URL('../../app/api/integrations/basecamp/timesheet/route.ts', import.meta.url), 'utf8');
    const pushLive = readFileSync(new URL('../basecamp/push-live.ts', import.meta.url), 'utf8');
    const timesheetLive = readFileSync(new URL('../basecamp/timesheet-live.ts', import.meta.url), 'utf8');
    const botLive = readFileSync(new URL('./live.ts', import.meta.url), 'utf8');
    const botRoute = readFileSync(new URL('../../app/api/bots/time/route.ts', import.meta.url), 'utf8');

    assert.match(pushRoute, /createLiveBasecampPushPost/);
    assert.match(timesheetRoute, /createLiveBasecampTimesheetPost/);
    assert.match(pushLive, /seoPlanPushTodolistId/);
    assert.match(pushLive, /createBasecampPushPost/);
    assert.match(timesheetLive, /createBasecampTimesheetPost/);
    assert.match(timesheetLive, /createTimesheetPerformer/);
    assert.match(botLive, /createLiveBasecampPushPost/);
    assert.match(botLive, /createLiveBasecampTimesheetPost/);
    assert.match(botLive, /basecampStepFromResponse/);
    assert.match(botLive, /BOT_ACTOR_EMAIL/);
    assert.match(botLive, /botCreatedTaskRow/);
    assert.match(botLive, /clientCategories/);
    assert.match(botRoute, /handleBotTimeRequest/);
    assert.match(botRoute, /liveBotTimeDeps/);
    assert.doesNotMatch(botRoute, /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/);
});
