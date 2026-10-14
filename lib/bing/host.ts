/**
 * Host key for auto-map. The exact Bing URL is stored and sent unchanged.
 * This key is only the comparison form: lowercase, no sc-domain prefix,
 * scheme, path, port, trailing dot, or leading www.
 */
export function hostKey(value: string | null | undefined): string | null {
    if (value == null) return null;
    let host = value.trim().toLowerCase();
    if (host.startsWith('sc-domain:')) host = host.slice('sc-domain:'.length).trim();
    if (host === '') return null;
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    host = host.replace(/^\/\//, '');
    const end = host.search(/[/?#]/);
    if (end >= 0) host = host.slice(0, end);
    if (host.startsWith('[')) return null;
    const at = host.lastIndexOf('@');
    if (at >= 0) host = host.slice(at + 1);
    host = host.replace(/:\d+$/, '');
    host = host.replace(/\.+$/, '');
    if (host.startsWith('www.')) host = host.slice(4);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
    return host;
}
