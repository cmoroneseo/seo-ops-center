import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sources = {
    'app/api/time-tracking/route.ts': readFileSync(new URL('../../app/api/time-tracking/route.ts', import.meta.url), 'utf8'),
    'lib/supabase/time-logs.ts': readFileSync(new URL('../supabase/time-logs.ts', import.meta.url), 'utf8'),
};

const migration = readFileSync(new URL('../../migrations/033_planner_time_segments.sql', import.meta.url), 'utf8');

test('segments are joined to time_logs by exactly two foreign keys', () => {
    // The simple parent FK plus the composite identity FK that serializes
    // tenant/owner changes. Two relationships make an unqualified PostgREST
    // embed ambiguous (PGRST201), so every embed must name the FK it wants.
    assert.match(migration, /time_log_id uuid not null references public\.time_logs\(id\)/i);
    assert.match(migration, /add constraint time_log_segments_parent_identity_fkey/i);
});

test('every segment embed disambiguates the relationship it joins on', () => {
    for (const [file, source] of Object.entries(sources)) {
        const embeds = source.match(/time_log_segments[!(][^)]*\(/g) ?? [];
        assert.ok(embeds.length > 0, `${file} should embed segments`);
        for (const embed of embeds) {
            assert.match(
                embed,
                /time_log_segments!time_log_segments_time_log_id_fkey\(/,
                `${file} has an ambiguous segment embed: ${embed}`,
            );
        }
    }
});
