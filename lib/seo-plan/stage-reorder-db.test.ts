import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { rewriteStageTasks } from './stage-reorder-db.ts';

const organizationId = 'organization';
const clientId = 'client';
const writes = [
    { id: 'first', position: 2, parentTaskId: null },
    { id: 'second', position: 1, parentTaskId: null },
];

for (const stages of [['onboarding', 'month_2'], [null, null]]) {
    test(`reorder passes through stored values ${JSON.stringify(stages)}`, async () => {
        const filters: unknown[] = [];
        let rpcCalls = 0;
        const db = {
            from(table: string) {
                assert.equal(table, 'tasks');
                return {
                    select(columns: string) {
                        assert.equal(columns, 'id, stage');
                        return this;
                    },
                    eq(column: string, value: string) {
                        filters.push([column, value]);
                        return this;
                    },
                    async in(column: string, ids: string[]) {
                        assert.equal(column, 'id');
                        assert.deepEqual(ids, ['first', 'second']);
                        return { data: writes.map((write, index) => ({ id: write.id, stage: stages[index] })) };
                    },
                };
            },
            async rpc(name: string, args: Record<string, unknown>) {
                rpcCalls++;
                assert.equal(name, 'reorder_stage_tasks');
                assert.equal(args.p_organization_id, organizationId);
                assert.equal(args.p_client_id, clientId);
                assert.deepEqual(args.p_patches, writes.map((write, index) => ({
                    id: write.id, stage: stages[index], position: write.position, parent_task_id: null,
                })));
                return { data: writes.map(write => ({ id: write.id, title: write.id, position: write.position })) };
            },
        } as unknown as SupabaseClient;

        const tasks = await rewriteStageTasks(db, organizationId, clientId, writes);
        assert.deepEqual(filters, [['organization_id', organizationId], ['client_id', clientId]]);
        assert.equal(rpcCalls, 1);
        assert.deepEqual(tasks.map(task => task.position), [2, 1]);
        assert.ok(tasks.every(task => !Object.hasOwn(task, 'stage')));
    });
}
