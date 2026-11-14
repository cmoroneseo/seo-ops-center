'use client';

import { useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { AnchorAttrs } from '@/lib/approvals-v2/anchor-attrs';
import type { PagePayload } from '@/lib/approvals-v2/registry';
import { Button } from '@/components/ui/button';
import { PagePreview } from './PagePreview';

export function PageEditor({ requestId, itemId, payload, photoPath, photoUrl, images, sent, versionNo, busy, onSave }: {
  requestId: string;
  itemId: string;
  payload: PagePayload;
  photoPath: string | null;
  photoUrl: string | null;
  images: Record<string, string | null>;
  sent: boolean;
  versionNo: number;
  busy: boolean;
  onSave: (item: { itemId: string; payload: PagePayload; photoPath: string | null; changeNote: string }) => Promise<unknown>;
}) {
  const [value, setValue] = useState(payload);
  const [photo, setPhoto] = useState(photoPath);
  const [preview, setPreview] = useState(photoUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, link: { protocols: ['http', 'https', 'mailto'], HTMLAttributes: { rel: 'noopener noreferrer nofollow' } } }), Image, TableKit, AnchorAttrs],
    content: payload.body,
    editorProps: { attributes: { class: 'approval-page-body min-h-64 rounded-lg border p-4 outline-none focus:ring-2', 'aria-label': 'Page body' } },
    onUpdate: ({ editor }) => setValue(previous => ({ ...previous, body: editor.getJSON() as PagePayload['body'] })),
  });
  const input = 'mt-1 block min-h-11 w-full rounded-md border bg-background p-2';
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10485760) throw new Error('Choose a JPG, PNG or WebP image up to 10 MB.');
      const response = await fetch(`/api/approval-requests/${requestId}/assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, contentType: file.type, size: file.size }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const uploaded = await fetch(result.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!uploaded.ok) throw new Error('Image upload failed. Try again.');
      setPhoto(result.objectKey);
      setPreview(URL.createObjectURL(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  }
  return <details className="rounded-xl border p-4">
    <summary className="min-h-11 cursor-pointer font-semibold">Edit page{sent ? ` · Editing creates version ${versionNo + 1}` : ''}</summary>
    <form className="mt-3 space-y-4" onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void onSave({ itemId, payload: value, photoPath: photo, changeNote: String(form.get('changeNote') ?? '') });
    }}>
      <label className="block">Page kind<select className={input} value={value.pageKind} onChange={event => setValue({ ...value, pageKind: event.target.value as PagePayload['pageKind'] })}><option value="blog">Blog</option><option value="service">Service page</option><option value="city">City page</option></select></label>
      {(['title', 'metaTitle', 'metaDescription', 'slug', 'plannedDate', 'targetKeyword', 'mockupAlt'] as const).map(key => {
        const labels = { title: 'Title', metaTitle: 'Meta title', metaDescription: 'Meta description', slug: 'Slug', plannedDate: 'Planned for (sign-off only; doesn’t set the date)', targetKeyword: 'Target keyword (internal only)', mockupAlt: 'Mockup alt text' };
        const limit = key === 'metaTitle' ? 60 : key === 'metaDescription' ? 160 : null;
        const length = (value[key] ?? '').length;
        return <label className="block" key={key}>{labels[key]}{limit && <span className={`ml-2 text-sm ${length > limit ? 'font-semibold text-amber-800' : 'text-muted-foreground'}`}>{length} / {limit}{length > limit ? ' · Longer than recommended' : ''}</span>}<input className={input} type={key === 'plannedDate' ? 'date' : 'text'} required={['title', 'metaTitle', 'slug'].includes(key)} maxLength={key === 'metaDescription' ? 320 : key === 'metaTitle' || key === 'targetKeyword' ? 120 : 200} value={value[key] ?? ''} onChange={event => {
          const next = { ...value, [key]: event.target.value };
          if (key === 'plannedDate' && !event.target.value) delete next.plannedDate;
          setValue(next);
        }} /></label>;
      })}
      <div><p className="mb-2 font-semibold">Page body</p><div className="mb-2 flex flex-wrap gap-2" role="toolbar" aria-label="Body formatting">
        <Button type="button" variant="outline" onClick={() => editor?.chain().focus().toggleBold().run()}>Bold</Button>
        <Button type="button" variant="outline" onClick={() => editor?.chain().focus().toggleItalic().run()}>Italic</Button>
        <Button type="button" variant="outline" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</Button>
        <Button type="button" variant="outline" onClick={() => editor?.chain().focus().toggleBulletList().run()}>Bullet list</Button>
        <Button type="button" variant="outline" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>Numbered list</Button>
        <Button type="button" variant="outline" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Table</Button>
      </div><EditorContent editor={editor} /></div>
      <label className="block">Mockup image (JPG, PNG or WebP, up to 10 MB)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || busy} className={input} onChange={event => void upload(event.target.files?.[0])} /></label>
      {photo && <Button type="button" variant="outline" onClick={() => { setPhoto(null); setPreview(null); }}>Remove mockup</Button>}
      {uploading && <p role="status">Uploading image…</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {sent && <label className="block">What changed?<textarea name="changeNote" required maxLength={500} className={input} /></label>}
      <Button disabled={busy || uploading || !editor}>{busy ? 'Saving…' : sent ? `Save version ${versionNo + 1}` : 'Save page draft'}</Button>
    </form>
    <div className="mt-6"><h3 className="mb-3 font-semibold">Preview</h3><PagePreview payload={value} photoUrl={preview} images={images} /></div>
  </details>;
}
