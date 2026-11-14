/** Readable plain-text fallback until the page renderer ships in 1C. */
export function approvalPlainText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const node = value as {
    type?: string;
    text?: string;
    content?: unknown[];
  };
  if (node.text !== undefined) return node.text;
  const separator = ['doc', 'bulletList', 'orderedList', 'listItem', 'table', 'tableRow'].includes(node.type ?? '') ? '\n' : '';
  return node.content?.map(approvalPlainText).join(separator) ?? (node.type === 'hardBreak' ? '\n' : '');
}
