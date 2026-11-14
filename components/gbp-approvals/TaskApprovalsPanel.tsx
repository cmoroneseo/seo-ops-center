'use client';

import { useEffect, useState } from 'react';

interface ApprovalItem {
    id: string;
    position: number;
    status: 'pending' | 'approved' | 'changes_requested';
}

interface ApprovalPayload {
    request: { id: string; title: string; round: number } | null;
    items?: ApprovalItem[];
    link?: { expiresAt: string; revokedAt: string | null; viewCount: number } | null;
    role?: string;
}

export function TaskApprovalsPanel({ taskId, taskTitle }: { taskId: string; taskTitle: string }) {
    const [data, setData] = useState<ApprovalPayload | null>(null);

    useEffect(() => {
        if (typeof fetch !== 'function') return undefined;
        let cancelled = false;
        fetch(`/api/gbp-approvals/tasks/${taskId}`)
            .then(async response => {
                if (!response.ok) return null;
                return response.json() as Promise<ApprovalPayload>;
            })
            .then(body => {
                if (!cancelled) setData(body);
            })
            .catch(() => {
                if (!cancelled) setData(null);
            });
        return () => {
            cancelled = true;
        };
    }, [taskId]);

    if (!data) return null;
    const counts = {
        approved: data.items?.filter(item => item.status === 'approved').length ?? 0,
        changes: data.items?.filter(item => item.status === 'changes_requested').length ?? 0,
        pending: data.items?.filter(item => item.status === 'pending').length ?? 0,
    };

    return (
        <section className="space-y-3 rounded-lg border border-border p-3" aria-label="Approvals">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Approvals</h3>
                {data.link && !data.link.revokedAt && <span className="text-xs text-muted-foreground">Link active</span>}
            </div>
            {!data.request && (
                <>
                    <p className="text-sm text-muted-foreground">The client can approve each post, request a change, suggest an edit, or upload a replacement photo. Nothing is sent until you share the link. {taskTitle}</p>
                </>
            )}
            {data.request && (
                <p className="text-sm text-muted-foreground">{counts.approved} approved · {counts.changes} changes requested · {counts.pending} pending · round {data.request.round}</p>
            )}
        </section>
    );
}
