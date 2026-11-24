'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useOrganization } from '@/components/providers/organization-provider';
import { getTasks } from '@/lib/supabase/tasks';
import type { Task } from '@/lib/types';

export function CreateDraftButton({
  taskId,
  taskTitle
}: {
  taskId?: string;
  taskTitle?: string;
}) {
  const {
    organization
  } = useOrganization();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [itemType, setItemType] = useState<'gbp_post' | 'page'>('gbp_post');
  const [postCount, setPostCount] = useState(1);
  useEffect(() => {
    if (!open || taskId || !organization) return;
    let cancelled = false;
    void getTasks(organization.id).then(rows => {
      if (!cancelled) setTasks(rows.filter(task => task.clientId));
    }).catch(() => {
      if (!cancelled) setError('Tasks could not be loaded.');
    });
    return () => {
      cancelled = true;
    };
  }, [open, taskId, organization]);
  async function create(form: HTMLFormElement) {
    setBusy(true);
    setError('');
    const values = new FormData(form);
    const items = Array.from({
      length: postCount
    }, (_, index) => ({
      position: index + 1,
      ...(itemType === 'page' ? { photoPath: String(values.get(`photo-${index}`) ?? '') || null } : {
        photoPaths: String(values.get(`photo-${index}`) ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean),
      }),
      payload: itemType === 'page' ? {
        schemaVersion: 1,
        pageKind: values.get(`kind-${index}`),
        title: values.get(`title-${index}`),
        metaTitle: values.get(`metaTitle-${index}`),
        metaDescription: values.get(`metaDescription-${index}`),
        slug: values.get(`slug-${index}`),
        ...(values.get(`date-${index}`) ? { plannedDate: values.get(`date-${index}`) } : {}),
        body: { format: 'markdown', text: values.get(`body-${index}`) }
      } : {
        schemaVersion: 1,
        postType: 'update',
        title: values.get(`title-${index}`),
        body: values.get(`body-${index}`),
        scheduledDate: values.get(`date-${index}`),
        offerStart: null,
        offerEnd: null,
        terms: '',
        ctaUrl: values.get(`url-${index}`),
        ctaLabel: 'Learn more'
      }
    }));
    try {
      const response = await fetch('/api/approval-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          itemType,
          taskId: taskId ?? values.get('task'),
          title: values.get('title'),
          items
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The draft could not be created.');
      window.dispatchEvent(new Event('approvals:changed'));
      setOpen(false);
      window.location.assign(result.reviewUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The draft could not be created.');
    } finally {
      setBusy(false);
    }
  }
  const input = 'mt-1 block min-h-11 w-full rounded-md border border-input bg-background p-2';
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button className="min-h-11 w-full sm:w-auto bg-[#DB0A8B] text-white hover:bg-[#b90875]"><Plus size={16} />Request approval</Button>
    </DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto">
      <DialogTitle>Create an approval draft</DialogTitle>
      <DialogDescription>Creates an internal draft. Nothing is sent.</DialogDescription>
      <form className="space-y-4 text-sm" onSubmit={event => {
        event.preventDefault();
        void create(event.currentTarget);
      }}>
        <label className="block">Content type<select className={input} value={itemType} onChange={event => { setItemType(event.target.value as 'gbp_post' | 'page'); setPostCount(1); }}><option value="gbp_post">GBP posts</option><option value="page">Pages</option></select></label>
        {!taskId && <label className="block">Task<select
          name="task"
          className={input}
          required>
          <option value="">Choose a task</option>
          {tasks.map(task => <option key={task.id} value={task.id}>
            {task.title}
          </option>)}
        </select></label>}
        <label className="block">Request title<input
          name="title"
          defaultValue={taskTitle}
          required
          maxLength={200}
          className={input} /></label>
        {Array.from({
          length: postCount
        }, (_, index) => <fieldset key={index} className="space-y-3 rounded-lg border p-3">
          <legend>{itemType === 'page' ? 'Page' : 'Post'} {index + 1}</legend>
          {itemType === 'page' && <>
            <label className="block">Page kind<select name={`kind-${index}`} className={input}><option value="blog">Blog</option><option value="service">Service page</option><option value="city">City page</option></select></label>
            <label className="block">Meta title<input name={`metaTitle-${index}`} required maxLength={120} className={input} /></label>
            <label className="block">Meta description<textarea name={`metaDescription-${index}`} maxLength={320} className={input} /></label>
            <label className="block">Slug<input name={`slug-${index}`} required maxLength={200} className={input} /></label>
          </>}
          <label className="block">Title<input
            name={`title-${index}`}
            required
            maxLength={itemType === 'page' ? 200 : 80}
            className={input} /></label>
          <label className="block">{itemType === 'page' ? 'Paste Markdown' : 'Post text'}<textarea
            name={`body-${index}`}
            required
            maxLength={itemType === 'page' ? 800000 : 2000}
            className={`${input} min-h-28`} /></label>
          <label className="block">Planned for<input
            type="date"
            name={`date-${index}`}
            required={itemType === 'gbp_post'}
            className={input} /></label>
          {itemType === 'gbp_post' && <label className="block">Learn more URL<input
            type="url"
            name={`url-${index}`}
            pattern="https://.*"
            required
            className={input}
            placeholder="https://" /></label>}
          {itemType === 'gbp_post' ? <label className="block">Photo URLs (optional)<textarea
            name={`photo-${index}`}
            className={input}
            rows={2}
            placeholder="One HTTPS URL per line, up to 10" /></label> : <label className="block">Photo URL (optional)<input
            type="url"
            name={`photo-${index}`}
            pattern="https://.*"
            className={input}
            placeholder="https://" /></label>}
        </fieldset>)}
        <Button
          type="button"
          variant="outline"
          disabled={postCount >= (itemType === 'page' ? 20 : 30) || busy}
          onClick={() => setPostCount(postCount + 1)}>{itemType === 'page' ? 'Add page' : 'Add post'}</Button>
        {error && <p role="alert" className="text-destructive">
          {error}
        </p>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create draft'}
        </Button>
      </form>
    </DialogContent>
  </Dialog>;
}
