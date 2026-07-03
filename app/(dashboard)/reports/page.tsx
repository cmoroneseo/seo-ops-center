'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FileText, Loader2 } from 'lucide-react';
import { useOrganization } from '@/components/providers/organization-provider';
import { useClients } from '@/lib/hooks/use-clients';
import { TemplateGallery, CustomTemplate } from '@/components/reports/TemplateGallery';
import { TemplatesTab } from '@/components/reports/TemplatesTab';
import { ReportsTable } from '@/components/reports/ReportsTable';
import { STOCK_TEMPLATES } from '@/lib/reports/reportTemplates';
import { cn } from '@/lib/utils';

type PageTab = 'reports' | 'templates';

const currentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export default function ReportsPage() {
    const { organization } = useOrganization();
    const { clients } = useClients({ statuses: ['Active'] });
    const [tab, setTab] = useState<PageTab>('reports');
    const [reports, setReports] = useState<any[]>([]);
    const [creatingReport, setCreatingReport] = useState(false);
    const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
    const router = useRouter();

    // Client/period are no longer chosen up front — a new report defaults to
    // the first active client and the current month, both adjustable inside
    // the builder's Settings tab (matches SE Ranking's pattern).
    const defaultClient = clients[0] ?? null;

    useEffect(() => {
        if (!organization) return;
        fetch(`/api/reports?orgId=${organization.id}`)
            .then(r => r.json())
            .then(d => setReports(d.reports ?? []))
            .catch(() => setReports([]));
    }, [organization?.id]);

    useEffect(() => {
        if (!organization) return;
        fetch(`/api/report-templates?orgId=${organization.id}`)
            .then(r => r.json())
            .then(d => setCustomTemplates(d.templates ?? []))
            .catch(() => setCustomTemplates([]));
    }, [organization?.id]);

    async function buildReport(blocks: { type: string; props?: Record<string, any> }[]) {
        if (!defaultClient || !organization) return;
        setCreatingReport(true);
        try {
            const res = await fetch('/api/reports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orgId: organization.id,
                    clientId: defaultClient.id,
                    clientName: defaultClient.clientName,
                    month: currentMonth(),
                    blocks,
                }),
            });
            const data = await res.json();
            if (res.ok && data.report?.id) {
                router.push(`/reports/${data.report.id}`);
            } else {
                setCreatingReport(false);
            }
        } catch {
            setCreatingReport(false);
        }
    }

    async function deleteReport(id: string) {
        await fetch(`/api/reports/${id}`, { method: 'DELETE' });
        setReports(prev => prev.filter(r => r.id !== id));
    }

    async function deleteTemplate(id: string) {
        await fetch(`/api/report-templates?id=${id}`, { method: 'DELETE' });
        setCustomTemplates(prev => prev.filter(t => t.id !== id));
    }

    const clientNames = Object.fromEntries(clients.map(c => [c.id, c.clientName]));

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight neon-gradient-text">Report Builder</h2>
                    <p className="text-muted-foreground mt-1">Build branded client reports from a template or from scratch.</p>
                </div>
                <button
                    onClick={() => buildReport(STOCK_TEMPLATES[0].build())}
                    disabled={!defaultClient || creatingReport}
                    className="flex items-center gap-2 text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2.5 hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-lg shadow-primary/20"
                >
                    {creatingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {creatingReport ? 'Creating…' : 'Create Report'}
                </button>
            </div>

            {/* Tabs */}
            <div className="border-b border-border flex gap-1">
                {([['reports', 'Reports'], ['templates', 'Templates']] as [PageTab, string][]).map(([key, label]) => (
                    <button key={key} onClick={() => setTab(key)}
                        className={cn(
                            'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                            tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                        )}>
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'reports' && (
                <div className="space-y-8">
                    <TemplateGallery
                        orgId={organization?.id ?? ''}
                        disabled={!defaultClient}
                        creating={creatingReport}
                        onPick={buildReport}
                        customTemplates={customTemplates}
                        onDeleteCustom={deleteTemplate}
                    />

                    {/* Saved reports */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                            <FileText className="h-4 w-4" /> Saved Reports
                        </h3>
                        <ReportsTable reports={reports} clientNames={clientNames} onDelete={deleteReport} />
                    </div>
                </div>
            )}

            {tab === 'templates' && (
                <TemplatesTab customTemplates={customTemplates} onDeleteCustom={deleteTemplate} />
            )}
        </div>
    );
}
