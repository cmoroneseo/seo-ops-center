export interface PageNode {
  type: string;
  text?: string;
  attrs?: Record<string, string | number>;
  marks?: {
    type: string;
    attrs?: Record<string, string>;
  }[];
  content?: PageNode[];
}
const nodes = new Set(['doc', 'heading', 'paragraph', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'table', 'tableRow', 'tableHeader', 'tableCell', 'image', 'horizontalRule', 'hardBreak', 'text']);
const blocked = new Set(['script', 'iframe', 'style', 'html', 'raw', 'rawhtml']);
const identity = /^[A-Za-z0-9._:-]{1,80}$/;
export const storageImage = /^(approval-assets|gbp-approvals)\/[0-9a-f-]{36}\/[0-9a-f-]{36}(\.preview\.jpg)?$/;
export function safeUrl(value: unknown, image = false): string | null {
  if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  if (image && storageImage.test(value)) return value;
  try {
    const url = new URL(value);
    return (image ? ['https:'] : ['http:', 'https:', 'mailto:']).includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}
export function nodeText(node: PageNode): string {
  return node.text ?? (node.content ?? []).map(nodeText).join(node.type === 'doc' ? '\n' : '');
}
function stripTags(text: string): string {
  // Character scanner instead of regex replaces: drops every tag and the contents of
  // script/style/iframe elements, and never leaves a '<' behind.
  let out = '';
  let i = 0;
  const lower = text.toLowerCase();
  while (i < text.length) {
    const open = text.indexOf('<', i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open);
    const close = text.indexOf('>', open);
    if (close === -1) {
      out += text.slice(open);
      break;
    }
    const name = /^<\s*(script|style|iframe)\b/.exec(lower.slice(open, close + 1))?.[1];
    if (name) {
      const end = lower.indexOf(`</${name}`, close);
      const endClose = end === -1 ? -1 : text.indexOf('>', end);
      i = endClose === -1 ? text.length : endClose + 1;
    } else {
      i = close + 1;
    }
  }
  return out.split('<').join('');
}

/** This is also run at render time: historical documents never bypass the allowlist. */
export function sanitizeDoc(input: unknown): PageNode & {
  type: 'doc';
  content: PageNode[];
} {
  if (new TextEncoder().encode(JSON.stringify(input)).length > 1048576) throw new Error('Page body exceeds 1 MB.');
  function clean(value: unknown, depth: number): PageNode[] {
    if (depth > 32) throw new Error('Page body is too deeply nested.');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const n = value as Record<string, unknown>;
    if (typeof n.type !== 'string' || blocked.has(n.type.toLowerCase())) return [];
    const content = Array.isArray(n.content) ? n.content.flatMap(child => clean(child, depth + 1)) : [];
    if (!nodes.has(n.type)) return content.length ? content : typeof n.text === 'string' ? [{
      type: 'text',
      text: stripTags(n.text)
    }] : [];
    const result: PageNode = {
      type: n.type
    };
    const attrs = n.attrs && typeof n.attrs === 'object' ? n.attrs as Record<string, unknown> : {};
    const allowed: Record<string, string | number> = {};
    for (const key of ['blockId', 'sectionId']) {
      if (typeof attrs[key] === 'string' && identity.test(attrs[key])) allowed[key] = attrs[key];
    }
    if (n.type === 'heading') allowed.level = Math.min(4, Math.max(1, Math.trunc(Number(attrs.level)) || 2));
    if (n.type === 'orderedList' && Number.isInteger(attrs.start) && Number(attrs.start) > 0) allowed.start = Number(attrs.start);
    if (n.type === 'image') {
      const src = safeUrl(attrs.src, true);
      if (!src) return [];
      allowed.src = src;
      allowed.alt = typeof attrs.alt === 'string' ? attrs.alt.slice(0, 200) : '';
    }
    if (Object.keys(allowed).length) result.attrs = allowed;
    if (n.type === 'text') {
      if (typeof n.text !== 'string' || !n.text) return [];
      result.text = n.text;
      if (Array.isArray(n.marks)) {
        result.marks = n.marks.flatMap(value => {
          if (!value || typeof value !== 'object') return [];
          const mark = value as {
            type?: string;
            attrs?: {
              href?: unknown;
            };
          };
          if (['bold', 'italic', 'code'].includes(mark.type ?? '')) return [{
            type: mark.type!
          }];
          const href = safeUrl(mark.attrs?.href);
          return mark.type === 'link' && href ? [{
            type: 'link',
            attrs: {
              href,
              rel: 'noopener noreferrer nofollow'
            }
          }] : [];
        });
        if (!result.marks.length) delete result.marks;
      }
    } else if (!['image', 'horizontalRule', 'hardBreak'].includes(n.type)) result.content = content;
    return [result];
  }
  const cleaned = clean(input, 0)[0];
  if (cleaned?.type !== 'doc') throw new Error('Page body must be a ProseMirror document.');
  return {
    ...cleaned,
    type: 'doc',
    content: cleaned.content ?? []
  };
}
function inline(text: string): PageNode[] {
  const result: PageNode[] = [];
  const pattern = /!\[([^\]]*)\]\(()|\[([^\]]+)\]\(()|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`/g;
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match[1] !== undefined || match[3] !== undefined) {
      const start = pattern.lastIndex;
      let end = start;
      let depth = 1;
      for (; end < text.length; end++) {
        const char = text[end];
        if (/\s/.test(char)) break;
        if (char === '\\' && /[()\\]/.test(text[end + 1] ?? '')) {
          end++;
          continue;
        }
        if (char === '(') depth++;
        if (char === ')' && --depth === 0) break;
      }
      if (depth !== 0) continue;
      match[match[1] !== undefined ? 2 : 4] = text.slice(start, end).replace(/\\([()\\])/g, '$1');
      pattern.lastIndex = end + 1;
    }
    if (match.index! > offset) result.push({
      type: 'text',
      text: text.slice(offset, match.index)
    });
    if (match[1] !== undefined) result.push({
      type: 'image',
      attrs: {
        alt: match[1],
        src: match[2]
      }
    });else result.push({
      type: 'text',
      text: match[3] ?? match[5] ?? match[6] ?? match[7],
      marks: [{
        type: match[3] ? 'link' : match[5] ? 'bold' : match[6] ? 'italic' : 'code',
        ...(match[3] ? {
          attrs: {
            href: match[4]
          }
        } : {})
      }]
    });
    offset = pattern.lastIndex;
  }
  if (offset < text.length) result.push({
    type: 'text',
    text: text.slice(offset)
  });
  return result;
}
export function markdownDoc(markdown: string, depth = 0): PageNode {
  if (depth > 32) throw new Error('Markdown is too deeply nested.');
  if (new TextEncoder().encode(markdown).length > 1048576) throw new Error('Markdown exceeds 1 MB.');
  // Raw HTML is never interpreted, including the contents of active HTML elements.
  const text = stripTags(markdown);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const content: PageNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      content.push({
        type: 'heading',
        attrs: {
          level: heading[1].length
        },
        content: inline(heading[2])
      });
    } else if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      content.push({
        type: 'horizontalRule'
      });
    } else if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      i--;
      content.push({
        type: 'blockquote',
        content: markdownDoc(quote.join('\n'), depth + 1).content
      });
    } else if (/^\s*(?:[-+*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: PageNode[] = [];
      const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-+*]\s+/;
      while (i < lines.length && pattern.test(lines[i])) {
        items.push({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: inline(lines[i++].replace(pattern, ''))
          }]
        });
      }
      i--;
      content.push({
        type: ordered ? 'orderedList' : 'bulletList',
        content: items
      });
    } else if (line.includes('|') && /^\s*\|?\s*:?-+/.test(lines[i + 1] ?? '')) {
      const cells = (row: string, header: boolean): PageNode => ({
        type: 'tableRow',
        content: row.replace(/^\||\|$/g, '').split('|').map(cell => ({
          type: header ? 'tableHeader' : 'tableCell',
          content: [{
            type: 'paragraph',
            content: inline(cell.trim())
          }]
        }))
      });
      const rows = [cells(line, true)];
      i += 2;
      while (i < lines.length && lines[i].includes('|')) rows.push(cells(lines[i++], false));
      i--;
      content.push({
        type: 'table',
        content: rows
      });
    } else if (/^!\[.*\]\(.+\)$/.test(line)) {
      content.push(...inline(line));
    } else {
      const paragraph = [line];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(?:#{1,4}\s|>|[-+*]\s|\d+\.\s|!\[)/.test(lines[i + 1])) paragraph.push(lines[++i]);
      content.push({
        type: 'paragraph',
        content: inline(paragraph.join('\n'))
      });
    }
  }
  return sanitizeDoc({
    type: 'doc',
    content
  });
}
