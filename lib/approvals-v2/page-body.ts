import { normalizeForMatch } from '../approvals/anchoring.ts';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, pagePayloadSchema, pageType } from './registry.ts';
import { markdownDoc, nodeText, sanitizeDoc, type PageNode } from './page-doc.ts';
export interface OutlineSection {
  sectionId: string;
  slug: string;
  level: number;
  title: string;
  hash: string;
  blocks: {
    blockId: string;
    kind: string;
    hash: string;
    len: number;
  }[];
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function headingSlug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
}
export function normalizePageBody(input: unknown) {
  const source = input as {
    format?: string;
    text?: string;
    doc?: unknown;
  } | null;
  const body = sanitizeDoc(source?.format === 'markdown' && typeof source.text === 'string' ? markdownDoc(source.text) : source?.format === 'prosemirror' ? source.doc : input);
  const outline: OutlineSection[] = [];
  const ids = new Set<string>();
  const sections = new Set<string>(['_intro']);
  const slugs = new Map<string, number>();
  let section: OutlineSection | undefined;
  function id(prefix: string, used: Set<string>, existing?: string | number): string {
    if (typeof existing === 'string' && !used.has(existing)) {
      used.add(existing);
      return existing;
    }
    let value = `${prefix}_${randomUUID()}`;
    while (used.has(value)) value += 'x';
    used.add(value);
    return value;
  }
  for (const block of body.content) {
    const text = normalizeForMatch(nodeText(block));
    const blockId = id('b', ids, block.attrs?.blockId);
    let slug = 'page-introduction';
    if (block.type === 'heading') {
      const base = headingSlug(nodeText(block));
      const count = slugs.get(base) ?? 0;
      slugs.set(base, count + 1);
      slug = count ? `${base}-${count}` : base;
    }
    if (!section || block.type === 'heading' && block.attrs?.level === 2) {
      const sectionId = block.type === 'heading' && block.attrs?.level === 2 ? id('s', sections, block.attrs?.sectionId) : '_intro';
      section = {
        sectionId,
        slug,
        level: Number(block.attrs?.level ?? 0),
        title: block.type === 'heading' ? nodeText(block).trim() : 'Introduction',
        hash: '',
        blocks: []
      };
      outline.push(section);
    }
    block.attrs = {
      ...block.attrs,
      blockId,
      sectionId: section.sectionId
    };
    const kind = ({
      bulletList: 'list',
      orderedList: 'list',
      blockquote: 'quote',
      horizontalRule: 'paragraph'
    } as Record<string, string>)[block.type] ?? block.type;
    section.blocks.push({
      blockId,
      kind,
      hash: hash(`${kind}:${normalizeForMatch(text)}`),
      len: [...text].length
    });
  }
  for (const section of outline) section.hash = hash(section.blocks.map(block => block.hash).join(''));
  if (Buffer.byteLength(JSON.stringify(outline)) > 65536) throw new Error('Page outline exceeds 64 KB.');
  return {
    body,
    outline,
    bodyHash: hash(canonicalJson(body))
  };
}
export function parsePagePayload(input: unknown) {
  try {
    if (!input || typeof input !== 'object') throw new Error('Each page needs a payload.');
    if (Buffer.byteLength(JSON.stringify(input)) > pageType.maxPayloadBytes) throw new Error('Page exceeds 1 MB.');
    const normalized = normalizePageBody((input as {
      body?: unknown;
    }).body);
    const payload = pagePayloadSchema.parse({
      ...input,
      body: normalized.body
    });
    if (Buffer.byteLength(JSON.stringify(payload)) > pageType.maxPayloadBytes) throw new Error('Page exceeds 1 MB.');
    return {
      ok: true as const,
      payload,
      outline: normalized.outline
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Invalid page.'
    };
  }
}
export function imagePaths(doc: unknown): string[] {
  const paths: string[] = [];
  function walk(node: PageNode) {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') paths.push(node.attrs.src);
    node.content?.forEach(walk);
  }
  walk(sanitizeDoc(doc));
  return paths;
}
