import { Parser } from 'htmlparser2';

/** Editable plain text from imports; never execute markup or rewrite an untouched record. */
export function taskDescriptionText(value?: string | null): string {
    if (!value) return '';
    if (!/<\/?(?:p|div|br|li|ul|ol|h[1-6]|a|strong|b|em|i|span|script|style|iframe|object|pre|blockquote|table|tr|td)\b/i.test(value)) return value;
    const chunks: string[] = [];
    const blocks = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'pre', 'blockquote']);
    const hidden = new Set(['script', 'style', 'iframe', 'object']);
    let hiddenDepth = 0;
    const links: (string | null)[] = [];
    const parser = new Parser({
        onopentag(name, attributes) {
            if (hidden.has(name)) hiddenDepth += 1;
            if (name === 'a') links.push(!hiddenDepth && /^(https?:\/\/|mailto:)/i.test(attributes.href ?? '') ? attributes.href : null);
            if (!hiddenDepth && (blocks.has(name) || name === 'br')) chunks.push('\n');
        },
        ontext(text) { if (!hiddenDepth) chunks.push(text); },
        onclosetag(name) {
            if (name === 'a') { const href = links.pop(); if (!hiddenDepth && href) chunks.push(` (${href})`); }
            if (hidden.has(name)) hiddenDepth = Math.max(0, hiddenDepth - 1);
            if (!hiddenDepth && blocks.has(name)) chunks.push('\n');
        },
    }, { decodeEntities: true });
    parser.end(value);
    return chunks.join('').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function taskDescriptionChanged(original: string | undefined, edited: string): boolean {
    return taskDescriptionText(original) !== edited;
}
