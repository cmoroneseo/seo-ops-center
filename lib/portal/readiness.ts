import type { PortalFeedbackEntry, PortalDeliverable, PortalPlanItem } from './progress';

export function validPortalDate(value: unknown): string | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function isOnboarding(launchDate: string | undefined, today: string): boolean {
    const start = validPortalDate(launchDate?.slice(0, 10));
    if (!start) return false;
    const elapsed = (Date.parse(today) - Date.parse(start)) / 86400000;
    return elapsed >= 0 && elapsed < 90;
}

export function deliveryTiming(item: PortalDeliverable, today: string) {
    const due = item.revisedDueDate ?? item.dueDate;
    return { due, overdue: item.bucket === 'in_progress' && Boolean(due && due < today) };
}

export function portalReadiness(input: {
    sharedPlan: boolean; items: PortalPlanItem[]; hasUpdate: boolean;
    deliverables: { status: string; dueDate?: string | null; revisedDueDate?: string | null; timingNote?: string | null }[];
    today: string;
}) {
    return [
        { key: 'plan', label: 'Publish the client SEO Plan', complete: input.sharedPlan },
        { key: 'dates', label: 'Confirm dates for upcoming work', complete: input.items.some(item => item.status === 'todo' && item.dueDate && item.dueDate >= input.today) },
        { key: 'update', label: 'Publish a welcome or progress update', complete: input.hasUpdate },
        { key: 'timing', label: 'Explain work past its planned date', complete: !input.deliverables.some(item => {
            const due = item.revisedDueDate ?? item.dueDate;
            return ['In Progress', 'Review', 'Approved'].includes(item.status) && due && due < input.today && !item.timingNote?.trim();
        }) },
    ];
}

/** Compute from messages; never cache a needs-reply flag that can go stale. */
export function conversationNeedsReply(entries: PortalFeedbackEntry[], handledThrough?: string | null): boolean {
    const latestClient = entries.filter(entry => entry.authorType !== 'team').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!latestClient) return false;
    const latestTeam = entries.filter(entry => entry.authorType === 'team').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const covered = [handledThrough ?? '', latestTeam?.createdAt ?? ''].sort().at(-1) ?? '';
    return latestClient.createdAt > covered;
}

export interface PortalUpdate {
    id: string; authorLabel: string; shipped: string; impact: string; nextSteps: string;
    blockers?: string; nextUpdateOn: string; publishedAt: string;
}

export function rowToPortalUpdate(row: Record<string, unknown>): PortalUpdate {
    return { id: String(row.id), authorLabel: String(row.author_label), shipped: String(row.shipped),
        impact: String(row.impact), nextSteps: String(row.next_steps),
        ...(row.blockers ? { blockers: String(row.blockers) } : {}),
        nextUpdateOn: String(row.next_update_on), publishedAt: String(row.published_at) };
}

export function reportTitleMonthMismatch(title: string, reportMonth: string): boolean {
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const match = title.toLowerCase().match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/);
    return Boolean(match && `${match[2]}-${String(months.indexOf(match[1]) + 1).padStart(2,'0')}` !== reportMonth);
}
