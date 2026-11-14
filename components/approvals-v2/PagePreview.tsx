import { createElement, type ReactNode } from 'react';
import type { PagePayload } from '@/lib/approvals-v2/registry';
import { nodeText, sanitizeDoc, safeUrl, type PageNode } from '@/lib/approvals-v2/page-doc';
export function PageBody({
  body,
  images = {}
}: {
  body: unknown;
  images?: Record<string, string | null>;
}) {
  let doc: PageNode;
  try {
    doc = sanitizeDoc(body);
  } catch {
    return <p role="alert">This page body could not be displayed.</p>;
  }
  const slugs = new Map<string, number>();
  function render(node: PageNode, key: string, top = false): ReactNode {
    if (node.type === 'text') {
      let text: ReactNode = node.text;
      for (const mark of node.marks ?? []) {
        text = mark.type === 'link' ? <a href={mark.attrs?.href} rel="noopener noreferrer nofollow">
          {text}
        </a> : createElement(mark.type === 'bold' ? 'strong' : mark.type === 'italic' ? 'em' : 'code', {}, text);
      }
      return <span key={key}>
        {text}
      </span>;
    }
    const attrs: Record<string, unknown> = {
      key
    };
    if (top) attrs['data-block-id'] = node.attrs?.blockId;
    if (node.type === 'heading') {
      const base = nodeText(node).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      const count = slugs.get(base) ?? 0;
      slugs.set(base, count + 1);
      attrs.id = count ? `${base}-${count}` : base;
    }
    if (node.type === 'image') {
      const path = String(node.attrs?.src ?? '');
      const src = images[path] ?? (path.startsWith('https://') ? safeUrl(path, true) : null);
      return src ? createElement('img', {
        ...attrs,
        src,
        alt: node.attrs?.alt ?? '',
        loading: 'lazy'
      }) : <p key={key}>Image unavailable</p>;
    }
    const tag = ({
      paragraph: 'p',
      heading: `h${node.attrs?.level ?? 2}`,
      bulletList: 'ul',
      orderedList: 'ol',
      listItem: 'li',
      blockquote: 'blockquote',
      table: 'table',
      tableRow: 'tr',
      tableHeader: 'th',
      tableCell: 'td',
      horizontalRule: 'hr',
      hardBreak: 'br'
    } as Record<string, string>)[node.type];
    const children = node.content?.map((child, index) => render(child, `${key}-${index}`));
    if (node.type === 'doc') return children;
    if (!tag) return null;
    if (node.type === 'orderedList') attrs.start = node.attrs?.start;
    if (['hr', 'br'].includes(tag)) return createElement(tag, attrs);
    return createElement(tag, attrs, node.type === 'table' ? <tbody>
      {children}
    </tbody> : children);
  }
  return <div id="page-introduction" className="approval-page-body">
    {doc.content?.map((node, index) => render(node, String(index), true))}
  </div>;
}
export function PagePreview({
  payload,
  photoUrl,
  images,
  domain = 'Your website'
}: {
  payload: PagePayload;
  photoUrl?: string | null;
  images?: Record<string, string | null>;
  domain?: string;
}) {
  return <div className="page-review-content space-y-5">
    <section aria-label="Search preview" className="rounded-xl border border-[#E2E3DF] bg-white p-5 text-[#1A1A1A]">
      <h3 className="mb-3 font-semibold">How it shows in Google</h3>
      <p className="mb-4 text-sm text-[#545A61]">What people may see in search results. Google sometimes shortens or rewrites these.</p>
      <p className="break-all text-sm">{domain} / {payload.slug}</p>
      <p className="my-2 text-xl text-[#1A0DAB]">
        {payload.metaTitle}
      </p>
      <p>
        {payload.metaDescription}
      </p>
      <p className="mt-4 rounded-lg bg-[#EEF0F2] p-3 text-sm">🔒 Read-only. Your account manager sets these search details, so they don’t take comments.</p>
    </section>
    {photoUrl && <figure className="overflow-hidden rounded-xl border bg-white">
      <figcaption className="border-b p-3 text-sm">Mockup image</figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoUrl} alt={payload.mockupAlt ?? ''} className="max-h-[600px] w-full object-contain" />
    </figure>}
    <section className="rounded-xl border border-[#E2E3DF] bg-white p-5 text-[#1A1A1A] sm:p-8" aria-label="Page content">
      <h1 className="mb-4 text-3xl font-bold">
        {payload.title}
      </h1>
      {payload.plannedDate && <p className="mb-5 text-[#545A61]">Planned for {payload.plannedDate}</p>}
      <PageBody body={payload.body} images={images} />
    </section>
  </div>;
}
