import { blockText, highlightAnchor } from './carry.ts';
import type { PageNode } from './page-doc.ts';
function boundary(text: string) {
  const normalized = blockText({ type: 'text', text });
  return [...normalized].length + Number(normalized.length > 0 && /\s$/.test(text));
}
/** DOM offsets use UTF-16; persisted offsets use the normalized block's code points. */
export function selectionAnchor(range: Range, content: HTMLElement, node: PageNode, hash: string) {
  if (!content.contains(range.startContainer))
    throw new Error('Start inside one content block.');
  const before = range.cloneRange();
  before.selectNodeContents(content);
  before.setEnd(range.startContainer, range.startOffset);
  let end: number | undefined;
  if (content.contains(range.endContainer)) {
    const through = range.cloneRange();
    through.selectNodeContents(content);
    through.setEnd(range.endContainer, range.endOffset);
    end = boundary(through.toString());
  }
  return highlightAnchor(node, hash, boundary(before.toString()), end);
}
