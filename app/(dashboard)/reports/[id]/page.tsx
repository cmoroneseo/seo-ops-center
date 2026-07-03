'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getClients } from '@/lib/supabase/clients';
import { useOrganization } from '@/components/providers/organization-provider';
import { ClientProject } from '@/lib/types';
import { ReportBuilder } from '@/components/reports/ReportBuilder';

export default function ReportBuilderPage() {
    const params = useParams();
    const id = params.id as string;
    const { organization } = useOrganization();
    const [data, setData] = useState<{ report: any; metrics: any; history: any } | null | undefined>(undefined);
    const [client, setClient] = useState<ClientProject | null>(null);

    const fetchReport = useCallback(() => {
        fetch(`/api/reports/${id}`)
            .then(r => (r.ok ? r.json() : null))
            .then(d => setData(d ?? null))
            .catch(() => setData(null));
    }, [id]);

    useEffect(() => { fetchReport(); }, [fetchReport]);

    useEffect(() => {
        if (!organization || !data?.report) return;
        // Unfiltered lookup — a saved report's client may since be archived/inactive.
        getClients(organization.id).then(all => {
            setClient(all.find(c => c.id === data.report.client_id) ?? null);
        });
    }, [organization?.id, data?.report?.client_id]);

    if (data === undefined || (data && !client)) {
        return (
            <div className="flex items-center justify-center h-[60vh] text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading report…
            </div>
        );
    }

    if (data === null) {
        return <div className="p-8 text-muted-foreground">Report not found.</div>;
    }

    return (
        <div className="-m-8">
            <ReportBuilder
                // Remount with fresh metrics/history whenever the report's
                // client or period changes (Settings tab reassignment / sync).
                key={`${data.report.client_id}-${data.report.report_month}`}
                client={client!}
                initialReport={data.report}
                metrics={data.metrics}
                history={data.history ?? {}}
                organizationId={organization?.id ?? ''}
                onDataChanged={fetchReport}
            />
        </div>
    );
}
