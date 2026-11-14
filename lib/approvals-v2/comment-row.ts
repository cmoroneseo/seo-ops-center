import type { CommentAnchor } from './carry';
export function rowAnchor(comment: Record<string, unknown>): CommentAnchor {
  return {
    anchorKind: comment.anchor_kind as CommentAnchor['anchorKind'],
    pinTarget: comment.pin_target as CommentAnchor['pinTarget'],
    sectionId: comment.section_id as string,
    blockId: comment.block_id as string,
    targetHash: comment.target_hash as string,
    rangeStart: comment.range_start as number,
    rangeEnd: comment.range_end as number,
    quote: comment.quote as string,
    quotePrefix: comment.quote_prefix as string,
    quoteSuffix: comment.quote_suffix as string
  };
}
