/**
 * The one place a user-supplied URL becomes an `href`.
 *
 * Session notes accept `[Label](url)` markdown, and four renderers used to put
 * the captured group straight into `href` — so a note reading
 * `[click](javascript:alert(document.cookie))` rendered as a working script
 * link. Every href built from user text now goes through `safeHref` instead.
 *
 * The rule is a scheme allowlist — `http:` and `https:` only — rather than a
 * blocklist of known-bad schemes, because a blocklist has to anticipate every
 * spelling of the attack and an allowlist does not.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Resolution base for same-origin paths. `.invalid` is reserved by RFC 2606
 * and can never be a real host, so comparing origins against it is a reliable
 * "did this path escape to another origin" test.
 */
const INTERNAL_BASE = 'https://internal.invalid';

/** Tab, line feed and carriage return — removed anywhere in a URL. */
const PARSER_STRIPPED = /[\u0009\u000a\u000d]/g;
/** Leading/trailing C0 controls and spaces — ignored by the parser. */
const PARSER_TRIMMED_LEADING = /^[\u0000-\u0020]+/;
const PARSER_TRIMMED_TRAILING = /[\u0000-\u0020]+$/;
/** Any control character left over once the parser's own strip is applied. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Strip what a URL parser would strip anyway.
 *
 * The WHATWG parser removes every tab, line feed and carriage return from a
 * URL before it looks at the scheme, and ignores leading/trailing C0 controls
 * and spaces. `java\nscript:alert(1)` is therefore a javascript URL to a
 * browser, and must be one to us too.
 */
function stripParserIgnoredCharacters(raw: string): string {
    return raw
        .replace(PARSER_STRIPPED, '')
        .replace(PARSER_TRIMMED_LEADING, '')
        .replace(PARSER_TRIMMED_TRAILING, '');
}

/**
 * The normalized URL when it is safe to link to, or null.
 *
 * Returns an absolute `http(s)` URL, or a same-origin `/path` unchanged in
 * meaning — internal links predate this helper and must keep working.
 */
export function safeHref(url: string): string | null {
    if (typeof url !== 'string') return null;

    const cleaned = stripParserIgnoredCharacters(url);
    if (!cleaned) return null;

    // Anything still holding a control character is not a URL a person typed;
    // it is an attempt to break a parser that disagrees with ours.
    if (CONTROL_CHARACTERS.test(cleaned)) return null;

    // `//evil.com` inherits the page's scheme and leaves the origin. It reads
    // like a path and is not one.
    if (cleaned.startsWith('//')) return null;

    if (cleaned.startsWith('/')) {
        let resolved: URL;
        try {
            resolved = new URL(cleaned, INTERNAL_BASE);
        } catch {
            return null;
        }
        if (resolved.origin !== INTERNAL_BASE) return null;
        const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
        // A backslash is a slash to the parser, so `/\evil.com` normalizes to
        // a protocol-relative path. Refuse the result, not just the input.
        return path.startsWith('//') ? null : path;
    }

    // Everything else must carry its own scheme, and it must be allowed.
    // `javascript:`, `data:`, `vbscript:`, `file:` and friends all land here
    // and all fail the allowlist. Percent-encoded scheme letters
    // (`%6Aavascript:`) never parse as a scheme at all, so they fail earlier.
    let parsed: URL;
    try {
        parsed = new URL(cleaned);
    } catch {
        return null;
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.href;
}

/**
 * Does this already-safe href leave the app.
 *
 * Only same-origin paths survive `safeHref` without a scheme, so anything that
 * is not a path is external and needs `target`/`rel` hardening.
 */
export function isExternalHref(href: string): boolean {
    return !href.startsWith('/');
}
