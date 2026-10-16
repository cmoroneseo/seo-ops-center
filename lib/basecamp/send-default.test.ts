import test from 'node:test';
import assert from 'node:assert/strict';
import {
    clientBasecampTimesheetEnabled,
    defaultSendToBasecamp,
    type BasecampTimesheetClientFields,
} from './send-default.ts';

const enabledClient: BasecampTimesheetClientFields = {
    basecamp_timesheet_enabled: true,
    basecamp_project_id: 48599958,
    basecamp_sync_enabled: true,
};

test('an enabled client with a Basecamp project defaults Send to Basecamp on', () => {
    assert.equal(clientBasecampTimesheetEnabled(enabledClient), true);
    assert.equal(defaultSendToBasecamp(true), true);
});

test('a client without timesheet sync or a Basecamp project defaults off', () => {
    assert.equal(clientBasecampTimesheetEnabled({
        ...enabledClient,
        basecamp_timesheet_enabled: false,
    }), false);
    assert.equal(clientBasecampTimesheetEnabled({
        ...enabledClient,
        basecamp_project_id: null,
    }), false);
    assert.equal(clientBasecampTimesheetEnabled({
        ...enabledClient,
        basecamp_project_id: '',
    }), false);
    assert.equal(clientBasecampTimesheetEnabled({
        ...enabledClient,
        basecamp_sync_enabled: false,
    }), false);
    assert.equal(defaultSendToBasecamp(false), false);
    assert.equal(defaultSendToBasecamp(clientBasecampTimesheetEnabled(null)), false);
});

test('a per-entry Send to Basecamp choice is kept', () => {
    const eligible = clientBasecampTimesheetEnabled(enabledClient);

    assert.equal(defaultSendToBasecamp(eligible, false), false);
    assert.equal(defaultSendToBasecamp(eligible, true), true);
    // Turning the toggle on cannot send when the client has nowhere to receive it.
    assert.equal(defaultSendToBasecamp(false, true), false);
});
