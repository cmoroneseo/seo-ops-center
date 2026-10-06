'use client';

import { useState } from 'react';
import { FeedbackThread } from './FeedbackThread';
import { PortalRefreshButton } from './PortalRefreshButton';
import type { PortalFeedbackEntry } from '@/lib/portal/progress';

export interface ClientConversation {
    subjectType: PortalFeedbackEntry['subjectType']; subjectId: string;
    title: string; entries: PortalFeedbackEntry[]; closed: boolean;
}

export function PortalConversations({ conversations }: { conversations: ClientConversation[] }) {
    const [selected, setSelected] = useState('');
    const active = conversations.find(thread => `${thread.subjectType}:${thread.subjectId}` === selected) ?? conversations[0];
    if (!active) return null;
    return <section className="portal-panel"><div className="flex flex-wrap items-center justify-between gap-3"><h2>Your conversations</h2><PortalRefreshButton /></div><p className="portal-panel-description">Questions and replies stay together. Notes are visible to your account team and invited contacts for this client.</p>
        {conversations.length > 1 && <label className="mt-5 block text-sm font-semibold">Conversation<select value={`${active.subjectType}:${active.subjectId}`} onChange={event => setSelected(event.target.value)} className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-3 text-sm">{conversations.map(thread => <option key={`${thread.subjectType}:${thread.subjectId}`} value={`${thread.subjectType}:${thread.subjectId}`}>{thread.title}{thread.closed ? ' · Completed request' : ''}</option>)}</select></label>}
        <FeedbackThread key={`${active.subjectType}:${active.subjectId}`} subjectType={active.subjectType} subjectId={active.subjectId} entries={active.entries} closed={active.closed} />
    </section>;
}
