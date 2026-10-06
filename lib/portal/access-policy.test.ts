import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyActor, generalFeedbackAllowed, clientPortalAllowedPath, contactErrorKind, isPortalLoginPath,
    portalCallbackUrl, reviewHandoffAllowed, safePortalNext,
} from './access-policy.ts';

test('staff membership wins over a portal contact', () => {
    assert.equal(classifyActor({
        membershipError: false,
        membershipCount: 1,
        contactError: 'none',
        contactCount: 1,
    }), 'staff');
});

test('a live contact with no membership is a client', () => {
    assert.equal(classifyActor({
        membershipError: false,
        membershipCount: 0,
        contactError: 'none',
        contactCount: 1,
    }), 'client');
});

test('a contact lookup failure fails closed onto the client fence', () => {
    assert.equal(classifyActor({
        membershipError: false,
        membershipCount: 0,
        contactError: 'other',
        contactCount: 0,
    }), 'client');
});

test('a missing portal table does not fence brand-new signups', () => {
    assert.equal(classifyActor({
        membershipError: false,
        membershipCount: 0,
        contactError: 'missing_relation',
        contactCount: 0,
    }), 'none');
});

test('membership lookup errors keep the agency app available', () => {
    assert.equal(classifyActor({
        membershipError: true,
        membershipCount: 0,
        contactError: 'other',
        contactCount: 1,
    }), 'staff');
});

test('contact error kinds recognize a migration that is not applied yet', () => {
    assert.equal(contactErrorKind(null), 'none');
    assert.equal(contactErrorKind({ code: 'PGRST205', message: 'schema cache' }), 'missing_relation');
    assert.equal(contactErrorKind({ code: '42501', message: 'permission denied' }), 'other');
});

test('client sessions stay on the portal, auth callback, and the token review portal', () => {
    assert.equal(clientPortalAllowedPath('/portal/plan'), true);
    assert.equal(clientPortalAllowedPath('/api/client-portal/decision'), true);
    assert.equal(clientPortalAllowedPath('/review/abc'), true);
    assert.equal(clientPortalAllowedPath('/api/portal/abc'), true);
    assert.equal(clientPortalAllowedPath('/auth/callback'), true);
    assert.equal(clientPortalAllowedPath('/dashboard'), false);
    assert.equal(clientPortalAllowedPath('/api/reports/11111111-1111-4111-8111-111111111111'), false);
    assert.equal(clientPortalAllowedPath('/client-portal/abc'), false);
    assert.equal(isPortalLoginPath('/portal/login'), true);
    assert.equal(isPortalLoginPath('/api/client-portal/login'), true);
    assert.equal(isPortalLoginPath('/api/client-portal/decision'), false);
});

test('portal next rejects staff routes and open redirects', () => {
    assert.equal(safePortalNext(null), '/portal');
    assert.equal(safePortalNext('/dashboard'), '/portal');
    assert.equal(safePortalNext('//evil.example'), '/portal');
    assert.equal(safePortalNext('/portal/login'), '/portal');
    assert.equal(safePortalNext('/portal/plan'), '/portal/plan');
    assert.equal(safePortalNext('/portal/reports/11111111-1111-4111-8111-111111111111?x=1'), '/portal/reports/11111111-1111-4111-8111-111111111111');
    assert.equal(safePortalNext('/portal/reports/not-a-uuid'), '/portal');
});

test('callback URL carries the portal invite and a safe next path', () => {
    const url = new URL(portalCallbackUrl('https://seo-ops.test', {
        portalInvite: 'raw-token',
        nextPath: '/dashboard',
    }));
    assert.equal(url.origin + url.pathname, 'https://seo-ops.test/auth/callback');
    assert.equal(url.searchParams.get('portal_invite'), 'raw-token');
    assert.equal(url.searchParams.get('next'), '/portal');
});

test('review handoff stops after eight fresh links', () => {
    assert.equal(reviewHandoffAllowed(7), true);
    assert.equal(reviewHandoffAllowed(8), false);
});

test('general feedback cannot target another client and messages are a safe magic-link destination', () => {
    const client = '11111111-1111-4111-8111-111111111111';
    assert.equal(generalFeedbackAllowed(client, client), true);
    assert.equal(generalFeedbackAllowed('22222222-2222-4222-8222-222222222222', client), false);
    assert.equal(generalFeedbackAllowed('invalid', client), false);
    assert.equal(safePortalNext('/portal/messages#message-compose'), '/portal/messages');
});
