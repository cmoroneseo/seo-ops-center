import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPublicAddress, isPublicAddress } from './network-policy.ts';

test('accepts ordinary public IPv4 and IPv6 addresses', () => {
    assert.equal(isPublicAddress('8.8.8.8'), true);
    assert.equal(isPublicAddress('1.1.1.1'), true);
    assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('rejects private, loopback, link-local, carrier NAT, and metadata IPv4', () => {
    for (const address of [
        '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
        '172.16.0.1', '192.168.1.1', '224.0.0.1', '255.255.255.255',
    ]) assert.equal(isPublicAddress(address), false, address);
});

test('rejects reserved, benchmark, and documentation IPv4', () => {
    for (const address of [
        '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1',
    ]) assert.equal(isPublicAddress(address), false, address);
});

test('rejects non-global and mapped IPv6 addresses', () => {
    for (const address of [
        '::', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fd00::1', 'fe80::1',
        'ff02::1', '2001:db8::1', '100::1',
    ]) assert.equal(isPublicAddress(address), false, address);
});

test('fails closed for malformed addresses and mixed DNS answers', () => {
    assert.equal(isPublicAddress('not-an-ip'), false);
    assert.throws(() => assertPublicAddress(['8.8.8.8', '127.0.0.1']), /public/i);
    assert.deepEqual(assertPublicAddress(['8.8.8.8', '1.1.1.1']), ['8.8.8.8', '1.1.1.1']);
});
