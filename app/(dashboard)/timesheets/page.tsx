import { TimesheetsShell } from '@/components/timesheets/TimesheetsShell';

export const metadata = { title: 'Timesheets' };

/**
 * /timesheets — the one trusted time ledger.
 *
 * My Timesheet is the weekly Ledger Grid; Team and Client review are
 * manager-only and gated server-side by their own API routes.
 */
export default async function TimesheetsPage({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const params = await searchParams;
    const tab = params.tab === 'imports' || params.tab === 'team' || params.tab === 'review' || params.tab === 'mine'
        ? params.tab
        : undefined;
    return <TimesheetsShell initialTab={tab} />;
}
