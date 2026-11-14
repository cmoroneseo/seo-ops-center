import { carryAnchor, blockText, type CommentAnchor } from './carry.ts';
import { sanitizeDoc, type PageNode } from './page-doc.ts';
import { normalizePageBody, type OutlineSection } from './page-body.ts';
/** Modify a copy of the current draft. Never use the released payload as the write target. */
export function applyCommentSuggestion(body: unknown, outline: OutlineSection[], anchor: CommentAnchor, suggestedText?: string | null, imageKey?: string | null) {
  const doc = sanitizeDoc(body);
  if (anchor.pinTarget === 'mockup' && imageKey)
    return normalizePageBody(doc);
  const carried = carryAnchor(anchor, doc, outline);
  if (['earlier', 'text_changed'].includes(carried.state))
    throw new Error('The original text changed. Edit the draft manually before resolving this comment.');
  const block = doc.content.find(block => block.attrs?.blockId === carried.blockId);
  if (!block)
    throw new Error('The target block is no longer in the draft.');
  if (imageKey) {
    if (block.type !== 'image')
      throw new Error('Only an image can be replaced.');
    block.attrs = { ...block.attrs, src: imageKey };
  }
  else {
    if (anchor.anchorKind !== 'highlight' || !suggestedText)
      throw new Error('No wording suggestion to accept.');
    const start = carried.rangeStart!;
    const end = carried.rangeEnd!;
    // Preserve marks and links on text outside the selected range.
    // Mapping uses the same normalized text as anchors, while edits keep original casing.
    let point = 0;
    let whitespace = false;
    let inserted = false;
    function edit(node: PageNode): PageNode[] {
      if (node.type !== 'text') {
        if (node.content)
          node.content = node.content.flatMap(edit);
        return [node];
      }
      let text = '';
      for (const char of node.text ?? '') {
        const space = /\s/.test(char);
        const counted = !space || !whitespace && point > 0;
        if (counted) {
          if (point === start && !inserted) {
            text += suggestedText;
            inserted = true;
          }
          if (point < start || point >= end)
            text += char;
          point++;
        }
        else if (point <= start || point > end)
          text += char;
        whitespace = space;
      }
      return text ? [{ ...node, text }] : [];
    }
    if ([...blockText(block)].slice(start, end).join('') !== anchor.quote)
      throw new Error('The selected wording changed.');
    block.content = block.content?.flatMap(edit);
    if (!inserted)
      throw new Error('The selected wording changed.');
  }
  return normalizePageBody(doc);
}
