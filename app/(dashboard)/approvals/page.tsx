'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import { CreateDraftButton } from '@/components/approvals-v2/CreateDraftButton';
import { groups, type ApprovalRow } from '@/lib/approvals-v2/list';
import { labels, StatusChip, TypeChip, LinkStatus, Owner } from '@/components/approvals-v2/Shared';
interface Data {
  rows: ApprovalRow[];
  counts: Record<string, number>;
  summaryCounts: Record<string, number>;
  nextCursor: string | null;
  clients: {
    id: string;
    name: string;
  }[];
  owners: {
    id: string;
    name: string;
  }[];
}
const control = 'min-h-11 rounded-lg border border-zinc-500 bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';
const typeLabels: Record<string, string> = {
  gbp_post: 'GBP posts',
  page: 'Pages',
  blog: 'Blog',
  service: 'Service page',
  city: 'City page'
};
function Approvals() {
  const params = useSearchParams(),
    router = useRouter();
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [filtersOpen, setFiltersOpen] = useState(false);
  const query = params.toString();
  useEffect(() => {
    const c = new AbortController();
    setError('');
    setData(null);
    fetch(`/api/approval-requests?${query}`, {
      signal: c.signal,
      cache: 'no-store'
    }).then(async r => {
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setData(b);
    }).catch(e => {
      if (!c.signal.aborted) setError(e.message);
    });
    return () => c.abort();
  }, [query]);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(query);
    next.delete('cursor');
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`/approvals?${next}`);
  }
  return <div className="space-y-5 p-4 pb-24 lg:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every approval request across clients. Nothing reaches a client until someone presses Send.</p>
      </div>
      <CreateDraftButton />
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {groups.map(g => <button
        key={g}
        className="rounded-xl border border-border bg-card p-4 text-left"
        onClick={() => filter('status', params.get('status') === g ? '' : g)}>
        <strong className="mb-2 block text-2xl">
          {data?.summaryCounts[g] ?? '—'}
        </strong>
        <StatusChip group={g} />
        {g === 'approved' && <span className="ml-1 text-xs text-muted-foreground">(30 days)</span>}
      </button>)}
    </div>
    <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-3">
      <label className="grow">
        <span className="sr-only">Search requests</span>
        <input
          className={`${control} w-full`}
          placeholder="Search requests"
          defaultValue={params.get('q') ?? ''}
          key={params.get('q')}
          onKeyDown={e => {
            if (e.key === 'Enter') filter('q', e.currentTarget.value);
          }}
          onBlur={e => {
            if (e.target.value !== (params.get('q') ?? '')) filter('q', e.target.value);
          }} />
      </label>
      <button
        className={`${control} lg:hidden`}
        aria-expanded={filtersOpen}
        aria-controls="approval-filters"
        onClick={() => setFiltersOpen(!filtersOpen)}>
        <SlidersHorizontal className="mr-2 inline" size={16} />Filters
      </button>
      <div id="approval-filters" className={`${filtersOpen ? 'flex' : 'hidden'} w-full flex-wrap gap-2 lg:flex lg:w-auto`}>
        {(['client', 'type', 'status', 'owner'] as const).map(key => <label key={key} className="flex items-center gap-1 text-sm">
          <span className="capitalize">
            {key}
          </span>
          <select
            className={control}
            value={params.get(key) ?? ''}
            onChange={e => filter(key, e.target.value)}>
            <option value="">
              {key === 'owner' ? 'Anyone' : `All ${key === 'status' ? 'statuses' : key + 's'}`}
            </option>
            {key === 'client' ? data?.clients.map(v => <option key={v.id} value={v.id}>
              {v.name}
            </option>) : key === 'owner' ? <>
              <option value="me">Me</option>
              <option value="bot">Bot</option>
              {data?.owners.map(v => <option key={v.id} value={v.id}>
                {v.name}
              </option>)}
            </> : key === 'status' ? groups.map(g => <option key={g} value={g}>
              {labels[g]}
            </option>) : [['gbp_post', 'GBP posts'], ['page', 'Pages'], ['blog', 'Blog'], ['service', 'Service page'], ['city', 'City page']].map(([v, l]) => <option key={v} value={v}>
              {l}
            </option>)}
          </select>
        </label>)}
      </div>
      <button
        className={`${control} flex items-center gap-2`}
        role="switch"
        aria-checked={params.get('archived') === 'true'}
        onClick={() => filter('archived', params.get('archived') === 'true' ? '' : 'true')}><span aria-hidden className="flex h-5 w-9 items-center rounded-full border border-zinc-500 px-0.5">
          <span className={`h-3.5 w-3.5 rounded-full bg-zinc-600 transition-transform ${params.get('archived') === 'true' ? 'translate-x-4' : ''}`} />
        </span><Archive size={16} />Show archived <strong>
          {params.get('archived') === 'true' ? 'On' : 'Off'}
        </strong></button>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {Array.from(params.entries()).filter(([k]) => !['cursor', 'sort'].includes(k)).map(([k, v]) => <button
        key={k}
        className={`${control} inline-flex items-center gap-2`}
        aria-label={`Remove ${k} filter`}
        onClick={() => filter(k, '')}>
        {k === 'type' ? typeLabels[v] ?? v : k === 'status' ? labels[v as keyof typeof labels] ?? v : v === 'true' ? 'Show archived: On' : data?.clients.find(c => c.id === v)?.name ?? data?.owners.find(o => o.id === v)?.name ?? v}
        <X size={14} />
      </button>)}
      <label className="ml-auto text-sm">Sort <select
        className={control}
        value={params.get('sort') ?? 'oldest'}
        onChange={e => filter('sort', e.target.value)}>
        <option value="updated">Recently updated</option>
        <option value="created">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="title">Title</option>
      </select></label>
    </div>
    {error && <p role="alert">
      {error}
    </p>}
    {!data && !error && <p role="status">Loading approvals…</p>}
    {data?.rows.length === 0 ? <div className="rounded-xl border bg-card p-10 text-center">
      <h2 className="text-lg font-semibold">
        {params.get('client') && params.get('type') ? `No ${params.get('type') === 'city' ? 'city page' : params.get('type') === 'service' ? 'service page' : params.get('type') === 'blog' ? 'blog' : params.get('type') === 'page' ? 'page' : 'GBP post'} requests for ${data.clients.find(client => client.id === params.get('client'))?.name ?? 'this client'}` : query ? 'No requests match these filters' : 'No approval requests yet'}
      </h2>
      <p className="my-3 text-muted-foreground">Try another client or type, or clear your filters.</p>
      <button className={control} onClick={() => router.replace('/approvals')}>Clear filters</button>
      <div className="mt-3">
        <CreateDraftButton />
      </div>
    </div> : groups.map(g => {
      const rows = data?.rows.filter(r => r.group === g) ?? [];
      if (!rows.length) return null;
      return <section key={g} className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex flex-wrap items-center gap-3 border-b bg-muted/30 p-4">
          <StatusChip group={g} />
          <span>
            {data?.counts[g]}
          </span>
          <p className="text-sm text-muted-foreground">
            {g === 'ready_to_send' ? "Internal drafts. The client can’t see these until someone presses Send." : g === 'waiting' ? 'Link shared. No response yet.' : g === 'changes_requested' ? 'The client asked for changes. Post a new version or reply.' : 'Signed off on the version the client saw.'}
          </p>
        </header>
        <div className="hidden grid-cols-[3fr_1fr_1fr_1fr_2fr_1fr_24px] gap-3 border-b px-4 py-3 text-xs uppercase text-muted-foreground lg:grid">
          {['Request', 'Type', 'Items', 'Age', 'Client link', 'Owner', ''].map((v, i) => <span key={i}>
            {v}
          </span>)}
        </div>
        {rows.map(r => <Link
          key={r.id}
          href={`/approvals/${r.id}`}
          className="focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-blue-600 relative grid grid-cols-[auto_1fr_auto] gap-2 border-b p-4 last:border-0 hover:bg-muted/30 lg:grid-cols-[3fr_1fr_1fr_1fr_2fr_1fr_24px] lg:items-center lg:gap-3">
          <div className="col-span-3 min-w-0 pr-6 lg:col-span-1 lg:pr-0">
            <strong className="block break-words">
              {r.title}
            </strong>
            <span className="text-sm text-muted-foreground">
              {r.client.name}
              {r.archivedAt ? ' · Archived' : ''}
            </span>
          </div>
          <div>
            <TypeChip row={r} />
          </div>
          <span className="text-sm">
            {r.itemCount}
            {' '}
            {r.itemCount === 1 ? 'item' : 'items'}
          </span>
          <span className="text-sm text-muted-foreground">Created {Math.max(0, Math.floor((Date.now() - Date.parse(r.createdAt)) / 86400000))}d ago</span>
          <div className="col-span-2 lg:col-span-1">
            <LinkStatus row={r} />
          </div>
          <Owner row={r} />
          <ChevronRight size={18} className="absolute right-4 top-5 lg:static" />
        </Link>)}
      </section>;
    })}
    {data?.nextCursor && <button className={control} onClick={() => {
      const p = new URLSearchParams(query);
      p.set('cursor', data.nextCursor!);
      router.push(`/approvals?${p}`);
    }}>Next 50 requests</button>}
  </div>;
}
export default function Page() {
  return <Suspense fallback={<p>Loading approvals…</p>}>
    <Approvals />
  </Suspense>;
}
