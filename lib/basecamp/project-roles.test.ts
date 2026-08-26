import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectRole, type ProjectRoleRecord } from './project-roles.ts';

const roles: ProjectRoleRecord[] = [
    { basecampProjectId: '46422132', basecampProjectName: '12 Volt Power', role: 'client', clientId: 'client-12v' },
    { basecampProjectId: '27062278', basecampProjectName: 'Marketing Empire Group HQ', role: 'internal', clientId: null },
    { basecampProjectId: '99999999', basecampProjectName: 'Dead Project', role: 'ignored', clientId: null },
];

test('a client project resolves to its client', () => {
    const result = resolveProjectRole(roles, { projectId: '46422132', projectName: '12 Volt Power' });

    assert.deepEqual(result, { kind: 'client', clientId: 'client-12v' });
});

test('an internal project resolves with no client', () => {
    const result = resolveProjectRole(roles, { projectId: '27062278', projectName: 'Marketing Empire Group HQ' });

    assert.deepEqual(result, { kind: 'internal', clientId: null });
});

test('an ignored project is skipped entirely', () => {
    const result = resolveProjectRole(roles, { projectId: '99999999', projectName: 'Dead Project' });

    assert.deepEqual(result, { kind: 'ignored', clientId: null });
});

test('an unknown project surfaces for a decision rather than being dropped', () => {
    const result = resolveProjectRole(roles, { projectId: '11111111', projectName: 'Superior Patios' });

    assert.deepEqual(result, { kind: 'unknown', clientId: null });
});

test('a CSV row with no project id resolves by name', () => {
    const result = resolveProjectRole(roles, { projectId: null, projectName: '12 Volt Power' });

    assert.deepEqual(result, { kind: 'client', clientId: 'client-12v' });
});

test('name matching ignores case and surrounding whitespace', () => {
    const result = resolveProjectRole(roles, { projectId: null, projectName: '  12 VOLT POWER ' });

    assert.deepEqual(result, { kind: 'client', clientId: 'client-12v' });
});

test('a project id wins over a conflicting name', () => {
    const result = resolveProjectRole(roles, { projectId: '27062278', projectName: '12 Volt Power' });

    assert.equal(result.kind, 'internal');
});

test('a name that matches nothing is unknown, never guessed to the nearest', () => {
    // "Pipe It Right" in the CSV vs client "Pipe It Right Plumbing" — close is
    // not good enough; a wrong client is worse than a review item.
    const result = resolveProjectRole(
        [{ basecampProjectId: '40889279', basecampProjectName: 'Pipe It Right Plumbing', role: 'client', clientId: 'client-pipe' }],
        { projectId: null, projectName: 'Pipe It Right' },
    );

    assert.equal(result.kind, 'unknown');
});

test('an empty roster resolves everything to unknown', () => {
    assert.equal(resolveProjectRole([], { projectId: '1', projectName: 'X' }).kind, 'unknown');
});
