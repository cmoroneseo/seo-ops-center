import { blockText, type CommentAnchor } from './carry.ts';
import { sanitizeDoc } from './page-doc.ts';
import type { OutlineSection } from './page-body.ts';
export function validCommentAnchor(anchor: CommentAnchor, body: unknown, outline: OutlineSection[]): boolean {
  if (anchor.anchorKind === 'page')
    return !anchor.blockId && !anchor.sectionId && !anchor.targetHash;
  if (anchor.anchorKind === 'pin' && anchor.pinTarget === 'mockup')
    return !anchor.blockId && !anchor.sectionId;
  const block = outline.find(section => section.sectionId === anchor.sectionId)?.blocks.find(block => block.blockId === anchor.blockId);
  if (!block || block.hash !== anchor.targetHash)
    return false;
  if (anchor.anchorKind === 'pin')
    return anchor.pinTarget === 'block';
  if (anchor.anchorKind !== 'highlight' || !Number.isInteger(anchor.rangeStart) || !Number.isInteger(anchor.rangeEnd))
    return false;
  const node = sanitizeDoc(body).content.find(node => node.attrs?.blockId === anchor.blockId);
  return !!node && anchor.rangeStart! >= 0 && anchor.rangeEnd! > anchor.rangeStart! && !!anchor.quote && [...anchor.quote].length <= 500
    && [...blockText(node)].slice(anchor.rangeStart, anchor.rangeEnd).join('') === anchor.quote;
}
