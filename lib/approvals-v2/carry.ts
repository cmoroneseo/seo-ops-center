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
  return normalizeForMatch(nodeText(node));
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
  const blocks = outline.flatMap(section => section.blocks.map(block => ({ ...block, sectionId: section.sectionId })));
  const same = blocks.find(block => block.blockId === anchor.blockId);
  const result = (state: 'same' | 'rehighlighted' | 'moved' | 'text_changed' | 'earlier' | 'image_changed', block = same, start = anchor.rangeStart) => ({
    ...anchor,
    state,
    blockId: block?.blockId,
    sectionId: block?.sectionId,
    rangeStart: start,
    rangeEnd: start === undefined ? undefined : start + [...(anchor.quote ?? '')].length
  });
  if (anchor.anchorKind === 'page')
    return result('same');
  if (anchor.pinTarget === 'mockup')
    return result(photoHash === anchor.targetHash ? 'same' : 'image_changed');
  if (same?.hash === anchor.targetHash)
    return result('same');
  if (anchor.anchorKind === 'highlight' && anchor.quote) {
    const candidates = [same, ...blocks.filter(block => block !== same && block.sectionId === anchor.sectionId), ...blocks.filter(block => block !== same && block.sectionId !== anchor.sectionId)].filter(block => !!block);
    for (const block of candidates) {
      const node = body.content?.find(node => node.attrs?.blockId === block.blockId);
      const text = node ? blockText(node) : '';
      const occurrences: {
        start: number;
        score: number;
      }[] = [];
      for (let at = text.indexOf(anchor.quote); at !== -1; at = text.indexOf(anchor.quote, at + 1)) {
        occurrences.push({ start: [...text.slice(0, at)].length, score: Number(!anchor.quotePrefix || text.slice(0, at).endsWith(anchor.quotePrefix)) + Number(!anchor.quoteSuffix || text.slice(at + anchor.quote.length).startsWith(anchor.quoteSuffix)) });
      }
      occurrences.sort((a, b) => b.score - a.score || Math.abs(a.start - (anchor.rangeStart ?? 0)) - Math.abs(b.start - (anchor.rangeStart ?? 0)));
      if (occurrences.length)
        return result(block === same ? 'rehighlighted' : 'moved', block, occurrences[0].start);
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
