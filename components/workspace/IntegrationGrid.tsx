'use client';

import Image from 'next/image';
import { BarChart3, Store, Mountain, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IntegrationCardId = 'gsc' | 'ga4' | 'gbp' | 'ahrefs' | 'basecamp';
export interface IntegrationCardItem {
    id: IntegrationCardId;
    name: string;
    description: string;
    status: string;
    tone: 'connected' | 'attention' | 'neutral';
}

export function IntegrationIcon({ service }: { service: IntegrationCardId }) {
    return <span aria-hidden="true" className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
        service === 'gsc' ? 'border bg-white' : service === 'ga4' ? 'bg-amber-500/10 text-amber-500' : service === 'gbp' ? 'bg-blue-500/10 text-blue-500' : service === 'ahrefs' ? 'bg-orange-500/10 text-orange-500' : 'bg-emerald-500/10 text-emerald-500')}>
        {service === 'gsc' ? <Image src="/integrations/google-search-console.png" width={28} height={28} alt="" /> : service === 'ga4' ? <BarChart3 className="h-7 w-7" /> : service === 'gbp' ? <Store className="h-7 w-7" /> : service === 'ahrefs' ? <span className="text-3xl font-bold">a</span> : <Mountain className="h-7 w-7" />}
    </span>;
}

export function IntegrationGrid({ items, selected, onSelect }: { items: IntegrationCardItem[]; selected: IntegrationCardId | null; onSelect: (id: IntegrationCardId) => void }) {
    return <div className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Available integrations">
        {items.map(item => <button key={item.id} id={`integration-card-${item.id}`} type="button" aria-expanded={selected === item.id} aria-controls={`integration-panel-${item.id}`} onClick={() => onSelect(item.id)}
            className={cn('group flex min-w-0 flex-col gap-7 rounded-2xl border bg-card p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-6', selected === item.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/60 hover:bg-muted/20')}>
            <span className="flex items-start gap-4"><IntegrationIcon service={item.id} /><span className="min-w-0"><span className="block text-base font-semibold tracking-tight">{item.name}</span><span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{item.description}</span></span></span>
            <span className="mt-auto flex w-full items-center justify-between gap-3"><span className={cn('flex items-center gap-2 text-xs font-medium', item.tone === 'connected' ? 'text-emerald-500' : item.tone === 'attention' ? 'text-amber-500' : 'text-muted-foreground')}>
                {item.tone === 'connected' ? <CheckCircle2 className="h-3.5 w-3.5" /> : item.tone === 'attention' ? <AlertCircle className="h-3.5 w-3.5" /> : null}{item.status}</span><ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', selected === item.id && 'rotate-90 text-primary')} /></span>
        </button>)}
    </div>;
}
