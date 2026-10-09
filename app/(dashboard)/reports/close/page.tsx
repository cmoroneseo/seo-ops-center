import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { CloseBoardPage } from '@/components/reports/close/CloseBoardPage';
import { searchReportingEnabled } from '@/lib/search-reporting/flag';

export default function ReportsClosePage() {
    if (!searchReportingEnabled()) notFound();
    return (
        <div className="h-full min-h-0">
            <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading the close board…</p>}>
                <CloseBoardPage />
            </Suspense>
        </div>
    );
}
