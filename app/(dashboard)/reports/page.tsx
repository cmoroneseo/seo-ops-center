import { redirect } from 'next/navigation';
import { ReportsIndex } from '@/components/reports/ReportsIndex';
import { reportsNavHref } from '@/lib/reports/close-nav';
import { searchReportingEnabled } from '@/lib/search-reporting/flag';

export default async function ReportsPage({
    searchParams,
}: {
    searchParams: Promise<{ builder?: string | string[] }>;
}) {
    const params = await searchParams;
    const builder = params.builder;
    const showBuilder = builder === '1' || (Array.isArray(builder) && builder.includes('1'));
    if (searchReportingEnabled() && !showBuilder) redirect(reportsNavHref());
    return <ReportsIndex />;
}
