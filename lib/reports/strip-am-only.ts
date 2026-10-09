/**
 * Removes AM-only blocks from HTML. Hiding them with CSS is not enough:
 * portal HTML, the print document, and the email body all run through this.
 */

const TAG_NAME = /^([a-zA-Z][\w:-]*)/;

function classList(attrs: string): string[] {
    const match = /\bclass\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs);
    if (!match) return [];
    return match[1] ? match[2].split(/\s+/).filter(Boolean) : [];
}

function isAmOnly(attrs: string): boolean {
    return classList(attrs).includes('amonly-block');
}

/**
 * Drops every element whose class list contains `amonly-block`, including
 * nested markup. Text outside those elements stays.
 */
export function stripAmOnly(html: string): string {
    let cursor = 0;
    let out = '';
    while (cursor < html.length) {
        const start = html.indexOf('<', cursor);
        if (start < 0) {
            out += html.slice(cursor);
            break;
        }
        out += html.slice(cursor, start);
        if (html.startsWith('<!--', start)) {
            const commentEnd = html.indexOf('-->', start + 4);
            const end = commentEnd < 0 ? html.length : commentEnd + 3;
            out += html.slice(start, end);
            cursor = end;
            continue;
        }
        const close = html.indexOf('>', start + 1);
        if (close < 0) {
            out += html.slice(start);
            break;
        }
        const raw = html.slice(start + 1, close);
        const selfClosing = /\/\s*$/.test(raw);
        const nameMatch = TAG_NAME.exec(raw.trim());
        const name = nameMatch?.[1] ?? '';
        const attrs = raw.slice(name.length);
        if (!name || !isAmOnly(attrs) || selfClosing) {
            out += html.slice(start, close + 1);
            cursor = close + 1;
            if (name && isAmOnly(attrs) && selfClosing) {
                out = out.slice(0, out.length - (close + 1 - start));
            }
            continue;
        }
        cursor = endOfElement(html, close + 1, name.toLowerCase());
    }
    return out;
}

function endOfElement(html: string, from: number, name: string): number {
    const open = new RegExp(`<${name}\\b[^>]*>`, 'gi');
    const shut = new RegExp(`</${name}\\s*>`, 'gi');
    open.lastIndex = from;
    shut.lastIndex = from;
    let depth = 1;
    while (depth > 0) {
        open.lastIndex = from;
        shut.lastIndex = from;
        const nextOpen = open.exec(html);
        const nextShut = shut.exec(html);
        if (!nextShut) return html.length;
        if (nextOpen && nextOpen.index < nextShut.index) {
            const raw = nextOpen[0];
            if (!/\/\s*>$/.test(raw)) depth += 1;
            from = nextOpen.index + raw.length;
            continue;
        }
        depth -= 1;
        from = nextShut.index + nextShut[0].length;
    }
    return from;
}

/** Visible text, for copy lint and absence checks. */
export function htmlText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}
