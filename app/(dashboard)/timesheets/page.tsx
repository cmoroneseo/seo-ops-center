import { TimesheetsShell } from '@/components/timesheets/TimesheetsShell';

export const metadata = { title: 'Timesheets' };

/**
 * /timesheets — the one trusted time ledger.
 *
 * My Timesheet is the weekly Ledger Grid; Team and Client review are
 * manager-only and gated server-side by their own API routes.
 */
export default function TimesheetsPage() {
    return <TimesheetsShell />;
}
