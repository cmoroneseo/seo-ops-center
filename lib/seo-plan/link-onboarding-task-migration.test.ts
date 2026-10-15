import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/100_link_onboarding_task_to_plan_item.sql', import.meta.url), 'utf8');

test('linking an onboarding task reuses the checklist row and refuses a second one', async () => {
    assert.doesNotMatch(migration, /delete\s+from\s+public\.marketing_plan_items/i);
    assert.ok(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').includes(migration.trim()));
    const db = new PGlite();
    const org = '00000000-0000-0000-0000-000000000010';
    const client = '00000000-0000-0000-0000-000000000020';
    const otherClient = '00000000-0000-0000-0000-000000000021';
    const plan = '00000000-0000-0000-0000-000000000030';
    const item = '00000000-0000-0000-0000-000000000040';
    const twin = '00000000-0000-0000-0000-000000000041';
    const task = '00000000-0000-0000-0000-000000000050';
    const foreign = '00000000-0000-0000-0000-000000000051';
    await db.exec(`
        create role authenticated;
        create role anon;
        create table marketing_plans(id uuid primary key, organization_id uuid, client_id uuid);
        create table tasks(id uuid primary key, organization_id uuid, client_id uuid, status text);
        create table marketing_plan_items(
            id uuid primary key,
            marketing_plan_id uuid,
            organization_id uuid,
            client_id uuid,
            task_id uuid,
            template_key text,
            source text,
            title text,
            status text,
            roadmap_included boolean,
            roadmap_phase text,
            updated_at timestamptz
        );
        insert into marketing_plans values ('${plan}', '${org}', '${client}');
        insert into tasks values
            ('${task}', '${org}', '${client}', 'todo'),
            ('${foreign}', '${org}', '${otherClient}', 'todo');
        insert into marketing_plan_items values
            ('${item}', '${plan}', '${org}', '${client}', null, 'tracking.consent', 'onboarding', 'Set up consent and Empire Cookies', 'ignored', false, 'backlog', null),
            ('${twin}', '${plan}', '${org}', '${client}', null, 'access.analytics', 'onboarding', 'Connect GA4 and Search Console', 'todo', true, 'month_1', null);
    `);
    await db.exec(migration);
    await db.exec('grant select, update on marketing_plan_items, tasks, marketing_plans to authenticated');
    await db.exec('set role authenticated');
    const linked = await db.query<{ id: string }>(
        'select link_task_onto_marketing_plan_item($1, $2) as id',
        [item, task],
    );
    assert.equal(linked.rows[0].id, item);
    const row = await db.query<{
        task_id: string;
        template_key: string;
        source: string;
        status: string;
        roadmap_included: boolean;
        roadmap_phase: string;
    }>('select task_id, template_key, source, status, roadmap_included, roadmap_phase from marketing_plan_items where id = $1', [item]);
    assert.equal(row.rows[0].task_id, task);
    assert.equal(row.rows[0].template_key, 'tracking.consent');
    assert.equal(row.rows[0].source, 'onboarding');
    assert.equal(row.rows[0].status, 'todo');
    assert.equal(row.rows[0].roadmap_included, true);
    assert.equal(row.rows[0].roadmap_phase, 'onboarding');
    const again = await db.query<{ id: string }>(
        'select link_task_onto_marketing_plan_item($1, $2) as id',
        [item, task],
    );
    assert.equal(again.rows[0].id, item);
    await assert.rejects(
        db.query('select link_task_onto_marketing_plan_item($1, $2)', [twin, task]),
        /already on this plan/,
    );
    await assert.rejects(
        db.query('select link_task_onto_marketing_plan_item($1, $2)', [item, foreign]),
        /belong to this client/,
    );
    await db.exec('set role anon');
    await assert.rejects(
        db.query('select link_task_onto_marketing_plan_item($1, $2)', [item, task]),
        /permission denied/i,
    );
});
