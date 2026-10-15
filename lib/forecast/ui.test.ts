import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string): string {
    return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('sync controls are admin-only and the preview is not a numbered wizard', () => {
    const team = read('../../components/timesheets/TeamTimesheetView.tsx');
    const planner = read('../../app/(dashboard)/planner/page.tsx');
    const header = read('../../components/planner/PlannerHeader.tsx');
    const dialog = read('../../components/forecast/ForecastSyncDialog.tsx');
    const button = read('../../components/forecast/ForecastSyncButton.tsx');
    const timesheets = read('../../app/(dashboard)/timesheets/page.tsx');

    assert.match(team, /ForecastSyncButton/);
    assert.match(button, /Sync to forecast/);
    assert.match(read('../../app/(dashboard)/settings/page.tsx'), /ForecastClientMap/);
    assert.match(read('../../app/api/forecast/client-links/route.ts'), /forecastClientLinksPut/);
    assert.match(team, />\s*Forecast\s*</);
    assert.match(team, /Last synced|lastSyncedLabel/);
    assert.match(planner, /role === 'owner' \|\| role === 'admin'/);
    assert.match(planner, /variant="outline"/);
    assert.match(header, /forecastSync/);
    assert.match(header, /aria-label="Planner view"/);
    assert.ok(header.indexOf('{forecastSync}') < header.indexOf('aria-label="Planner view"'));
    assert.match(dialog, /Sync to Campaign Desk/);
    assert.match(dialog, />\s*Cancel\s*</);
    assert.match(dialog, /Review/);
    assert.match(button, /Undo/);
    assert.match(timesheets, /tab=imports|tab === 'imports'/);
    assert.equal(/^\s*\d+\.\s/m.test(dialog), false);
    assert.equal(dialog.includes('Step '), false);
});
