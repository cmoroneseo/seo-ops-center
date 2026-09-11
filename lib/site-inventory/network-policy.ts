import { isIP } from 'node:net';

function ipv4Number(address: string) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inV4Range(value: number, base: number, prefix: number) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (base & mask);
}

function isPublicIpv4(address: string) {
    const value = ipv4Number(address);
    if (value === null) return false;
    const blocked: Array<[string, number]> = [
        ['0.0.0.0', 8],
        ['10.0.0.0', 8],
        ['100.64.0.0', 10],
        ['127.0.0.0', 8],
        ['169.254.0.0', 16],
        ['172.16.0.0', 12],
        ['192.0.0.0', 24],
        ['192.0.2.0', 24],
        ['192.168.0.0', 16],
        ['198.18.0.0', 15],
        ['198.51.100.0', 24],
        ['203.0.113.0', 24],
        ['224.0.0.0', 4],
        ['240.0.0.0', 4],
    ];
    return !blocked.some(([base, prefix]) => inV4Range(value, ipv4Number(base)!, prefix));
}

function normalizedIpv6(address: string) {
    return address.toLowerCase().split('%')[0];
}

function mappedIpv4(address: string) {
    const normalized = normalizedIpv6(address);
    const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (dotted) return dotted;
    const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (!hex) return null;
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPublicIpv6(address: string) {
    const normalized = normalizedIpv6(address);
    const mapped = mappedIpv4(normalized);
    if (mapped) return false;
    if (!/^[23][0-9a-f]{0,3}:/.test(normalized)) return false;
    if (/^2001:db8(?::|$)/.test(normalized)) return false;
    if (/^2001:0?0?0?2(?::|$)/.test(normalized)) return false;
    return true;
}

export function isPublicAddress(address: string) {
    const kind = isIP(address.split('%')[0]);
    if (kind === 4) return isPublicIpv4(address);
    if (kind === 6) return isPublicIpv6(address);
    return false;
}

export function assertPublicAddress(addresses: string[]) {
    if (addresses.length === 0 || addresses.some(address => !isPublicAddress(address))) {
        throw new Error('Host did not resolve exclusively to public addresses');
    }
    return addresses;
}
