import { notFound } from 'next/navigation';
import { ClientReport } from '@/components/client-report/ClientReport';
import { scottColeReport } from '@/lib/reports/client-fixture';

export default async function ClientReportPreviewPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
    if (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_SEARCH_REPORTING !== 'true') notFound();
    const query = await searchParams;
    const audience = query.audience === 'staff' ? 'staff' : 'client';
    return <ClientReport model={scottColeReport(audience)} audience={audience} />;
}
