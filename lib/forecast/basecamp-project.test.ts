import test from 'node:test';
import assert from 'node:assert/strict';
import {
    attributeBasecampProject,
    projectDeskClientKey,
    projectStem,
    type ForecastBasecampProject,
} from './basecamp-project.ts';

const CLIENT = '33333333-3333-4333-8333-333333333333';
const WATCH = 'Our Watch w/Tim Thompson Growth OS – Powered by the Empire Method™';

test('a growth-os title keeps the client stem, and a project key stays stable', () => {
    assert.equal(projectStem(WATCH), 'Our Watch w/Tim Thompson');
    assert.equal(projectStem('Pipe It Right'), 'Pipe It Right');
    const key = projectDeskClientKey('47923138');
    assert.equal(key, projectDeskClientKey('47923138'));
    assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('a bound Basecamp project uses that SEO client', () => {
    const project: ForecastBasecampProject = {
        id: '47923138',
        name: WATCH,
        kind: 'client',
        clientId: CLIENT,
        clientName: 'Our Watch',
        clientDomain: 'ourwatch.com',
    };
    const attributed = attributeBasecampProject({
        projectId: '47923138',
        projects: [project],
        seoClients: [],
        deskClients: [{ id: 'rc_other', name: 'Other Co' }],
        links: new Map(),
    });
    assert.equal(attributed?.clientId, CLIENT);
    assert.equal(attributed?.clientName, 'Our Watch');
    assert.equal(attributed?.clientDomain, 'ourwatch.com');
    assert.equal(attributed?.campaignDeskClientId, null);
});

test('an internal project stays off the client forecast even when the name matches', () => {
    const attributed = attributeBasecampProject({
        projectId: '27062278',
        projects: [{
            id: '27062278',
            name: 'Marketing Empire Group HQ',
            kind: 'internal',
        }],
        seoClients: [],
        deskClients: [{ id: 'rc_hq', name: 'Marketing Empire Group HQ' }],
        links: new Map(),
    });
    assert.equal(attributed, null);
});

test('a project name prefix matches one Campaign Desk client when no SEO client exists', () => {
    const attributed = attributeBasecampProject({
        projectId: '47923138',
        projects: [{ id: '47923138', name: WATCH, kind: 'unknown' }],
        seoClients: [],
        deskClients: [
            { id: 'rc_watch', name: 'Our Watch' },
            { id: 'rc_other', name: 'Other Co' },
        ],
        links: new Map(),
    });
    assert.equal(attributed?.clientName, 'Our Watch');
    assert.equal(attributed?.campaignDeskClientId, 'rc_watch');
    assert.equal(attributed?.clientId, projectDeskClientKey('47923138'));
});

test('a desk name match uses the SEO client already linked to that desk id', () => {
    const attributed = attributeBasecampProject({
        projectId: '47923138',
        projects: [{ id: '47923138', name: WATCH, kind: 'unknown' }],
        seoClients: [{ id: CLIENT, name: 'Tim Thompson Co', domain: 'ourwatch.com' }],
        deskClients: [{ id: 'rc_watch', name: 'Our Watch w/Tim Thompson' }],
        links: new Map([[CLIENT, 'rc_watch']]),
    });
    assert.equal(attributed?.clientId, CLIENT);
    assert.equal(attributed?.clientName, 'Tim Thompson Co');
    assert.equal(attributed?.campaignDeskClientId, null);
});

test('two Campaign Desk names that both fit the project stay unmatched', () => {
    const attributed = attributeBasecampProject({
        projectId: '47923138',
        projects: [{ id: '47923138', name: WATCH, kind: 'unknown' }],
        seoClients: [],
        deskClients: [
            { id: 'rc_a', name: 'Our Watch' },
            { id: 'rc_b', name: 'Our Watch w/Tim' },
        ],
        links: new Map(),
    });
    assert.equal(attributed, null);
});
