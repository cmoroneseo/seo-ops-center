import { normalizeForMatch } from '../approvals/anchoring.ts';
import { nodeText, type PageNode } from './page-doc.ts';
import type { OutlineSection } from './page-body.ts';
export interface CommentAnchor {
  anchorKind: 'highlight' | 'pin' | 'page';
  pinTarget?: 'block' | 'mockup';
  sectionId?: string;
  blockId?: string;
  targetHash?: string;
  rangeStart?: number;
  rangeEnd?: number;
  quote?: string;
  quotePrefix?: string;
  quoteSuffix?: string;
}
export interface DraftComment extends CommentAnchor {
  id: string;
  itemId: string;
  versionId: string;
  body: string;
  suggestedText?: string;
  suggestedImageReservationId?: string;
  previewUrl?: string;
}
export function blockText(node: PageNode) {
  return nodeText(node)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
/** Offsets are code points, never UTF-16 units. Cross-block selections end at the first block. */
export function highlightAnchor(node: PageNode, targetHash: string, start: number, end?: number): CommentAnchor {
  const points = [...blockText(node)];
  const rangeEnd = Math.min(end ?? points.length, points.length);
  if (start < 0 || start >= rangeEnd || rangeEnd - start > 500)
    throw new Error('Select between 1 and 500 characters.');
  return {
    anchorKind: 'highlight',
    blockId: String(node.attrs?.blockId),
    sectionId: String(node.attrs?.sectionId),
    targetHash,
    rangeStart: start,
    rangeEnd,
    quote: points.slice(start, rangeEnd).join(''),
    quotePrefix: points.slice(Math.max(0, start - 64), start).join(''),
    quoteSuffix: points.slice(rangeEnd, rangeEnd + 64).join('')
  };
}
export function carryAnchor(anchor: CommentAnchor, body: PageNode, outline: OutlineSection[], photoHash?: string, previousOutline: OutlineSection[] = []) {
  // Sentinels retain boundary spaces in quotes and context during normalization.
  const matchText = (text: string) => normalizeForMatch(`x${text}x`).slice(1, -1);
  const blocks = outline.flatMap(section => section.blocks.map(block => ({ ...block, sectionId: section.sectionId })));
  const same = blocks.find(block => block.blockId === anchor.blockId);
  const result = (state: 'same' | 'rehighlighted' | 'moved' | 'text_changed' | 'earlier' | 'image_changed', block = same, start = anchor.rangeStart, end = start === undefined ? undefined : start + [...(anchor.quote ?? '')].length) => ({
    ...anchor,
    state,
    blockId: block?.blockId,
    sectionId: block?.sectionId,
    rangeStart: start,
    rangeEnd: end
  });
  if (anchor.anchorKind === 'page')
    return result('same');
  if (anchor.pinTarget === 'mockup')
    return result(photoHash === anchor.targetHash ? 'same' : 'image_changed');
  if (same?.hash === anchor.targetHash && anchor.anchorKind !== 'highlight')
    return result('same');
  if (anchor.anchorKind === 'highlight' && anchor.quote) {
    const candidates = [same, ...blocks.filter(block => block !== same && block.sectionId === anchor.sectionId), ...blocks.filter(block => block !== same && block.sectionId !== anchor.sectionId)].filter(block => !!block);
    for (const block of candidates) {
      const node = body.content?.find(node => node.attrs?.blockId === block.blockId);
      const source = node ? blockText(node) : '';
      const text = matchText(source);
      const quote = matchText(anchor.quote);
      // Lowercasing can expand a code point (İ → i + combining dot).
      const boundaries = new Map<number, number>([[0, 0]]);
      let offset = 0;
      [...source].forEach((point, index) => {
        offset += point.toLowerCase().length;
        boundaries.set(offset, index + 1);
      });
      const occurrences: {
        start: number;
        end: number;
        score: number;
      }[] = [];
      for (let at = text.indexOf(quote); quote && at !== -1; at = text.indexOf(quote, at + 1)) {
        const start = boundaries.get(at);
        const end = boundaries.get(at + quote.length);
        if (start !== undefined && end !== undefined)
          occurrences.push({ start, end, score: Number(!anchor.quotePrefix || text.slice(0, at).endsWith(matchText(anchor.quotePrefix))) + Number(!anchor.quoteSuffix || text.slice(at + quote.length).startsWith(matchText(anchor.quoteSuffix))) });
      }
      occurrences.sort((a, b) => b.score - a.score || Math.abs(a.start - (anchor.rangeStart ?? 0)) - Math.abs(b.start - (anchor.rangeStart ?? 0)));
      if (occurrences.length)
        return result(block === same ? block.hash === anchor.targetHash ? 'same' : 'rehighlighted' : 'moved', block, occurrences[0].start, occurrences[0].end);
    }
  }
  else {
    const moved = blocks.find(block => block.hash === anchor.targetHash);
    if (moved)
      return result('moved', moved);
  }
  const previous = previousOutline.flatMap(section => section.blocks);
  const oldIndex = previous.findIndex(block => block.blockId === anchor.blockId);
  const candidates = blocks.filter(block => block.sectionId === anchor.sectionId);
  if (oldIndex >= 0)
    candidates.sort((a, b) => {
      const distance = (id: string) => {
        const index = previous.findIndex(block => block.blockId === id);
        return index < 0 ? Number.MAX_SAFE_INTEGER : Math.abs(index - oldIndex);
      };
      return distance(a.blockId) - distance(b.blockId);
    });
  const nearest = same ?? candidates.find(block => block.kind === 'paragraph') ?? candidates[0];
  return nearest ? result('text_changed', nearest) : result('earlier');
}
