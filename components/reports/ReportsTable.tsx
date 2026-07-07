'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Trash2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReportRow {
    id: string;
    title: string;
    client_id: string | null;
    report_month: string;
    status: 'draft' | 'published';
    updated_at: string;
}

interface Props {
    reports: ReportRow[];
    clientNames: Record<string, string>;
    onDelete: (id: string) => void;
}

const reportMonthLabel = (m: string) => new Date(m + '-15').toLocaleString('default', { month: 'long', year: 'numeric' });
const dateLabel = (d: string) => new Date(d).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });

export function ReportsTable({ reports, clientNames, onDelete }: Props) {
    const router = useRouter();
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return reports;
        return reports.filter(r =>
            r.title.toLowerCase().includes(q) ||
            (r.client_id && clientNames[r.client_id] || '').toLowerCase().includes(q),
        );
    }, [reports, clientNames, query]);

    if (reports.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center bg-card border border-dashed border-border rounded-xl">
                <FileText className="h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No reports yet — pick a template above to build your first one.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="relative max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                    value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="Search reports…"
                    className="w-full text-sm bg-background border border-border rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
            </div>

            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-muted/50 text-muted-foreground font-medium">
                            <tr>
                                <th className="px-4 py-3 min-w-[220px]">Report</th>
                                <th className="px-4 py-3">Client</th>
                                <th className="px-4 py-3">Period</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3 whitespace-nowrap">Updated</th>
                                <th className="px-4 py-3 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {filtered.map(r => (
                                <tr key={r.id} onClick={() => router.push(`/reports/${r.id}`)} className="hover:bg-muted/30 cursor-pointer transition-colors">
                                    <td className="px-4 py-3 font-medium truncate max-w-xs">{r.title}</td>
                                    <td className="px-4 py-3 text-muted-foreground">{(r.client_id && clientNames[r.client_id]) || '—'}</td>
                                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{reportMonthLabel(r.report_month)}</td>
                                    <td className="px-4 py-3">
                                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', r.status === 'published' ? 'bg-green-500/15 text-green-500' : 'bg-muted text-muted-foreground')}>
                                            {r.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{dateLabel(r.updated_at)}</td>
                                    <td className="px-4 py-3">
                                        <button
                                            onClick={e => { e.stopPropagation(); onDelete(r.id); }}
                                            className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No reports match “{query}”.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
