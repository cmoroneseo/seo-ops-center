'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useOrganization } from '@/components/providers/organization-provider';
import { getTasks } from '@/lib/supabase/tasks';
import type { Task } from '@/lib/types';

/** GBP fallback; page sources and rich editing belong to 1C. */
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
      photoPath: String(values.get(`photo-${index}`) ?? '') || null,
      payload: {
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
      <DialogDescription>GBP posts. Creates an internal draft. Nothing is sent. Page creation arrives in the next update.</DialogDescription>
      <form className="space-y-4 text-sm" onSubmit={event => {
        event.preventDefault();
        void create(event.currentTarget);
      }}>
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
          <legend>Post {index + 1} · Update</legend>
          <label className="block">Title<input
            name={`title-${index}`}
            required
            maxLength={80}
            className={input} /></label>
          <label className="block">Post text<textarea
            name={`body-${index}`}
            required
            maxLength={2000}
            className={`${input} min-h-28`} /></label>
          <label className="block">Planned for<input
            type="date"
            name={`date-${index}`}
            required
            className={input} /></label>
          <label className="block">Learn more URL<input
            type="url"
            name={`url-${index}`}
            pattern="https://.*"
            required
            className={input}
            placeholder="https://" /></label>
          <label className="block">Photo URL (optional)<input
            type="url"
            name={`photo-${index}`}
            pattern="https://.*"
            className={input}
            placeholder="https://" /></label>
        </fieldset>)}
        <Button
          type="button"
          variant="outline"
          disabled={postCount >= 30 || busy}
          onClick={() => setPostCount(postCount + 1)}>Add post</Button>
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
