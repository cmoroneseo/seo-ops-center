export function formatVaultDate(value: string | null | undefined): string {
    if (!value) return '—';
    const day = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '—';
    const date = new Date(`${day}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const VAULT_TYPE_CLASS: Record<string, string> = {
    decision: 'bg-sky-500/10 text-sky-800 dark:text-sky-200',
    rule: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
    approval: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
    contact: 'bg-violet-500/10 text-violet-800 dark:text-violet-200',
    precedent: 'bg-slate-500/10 text-slate-700 dark:text-slate-200',
};
