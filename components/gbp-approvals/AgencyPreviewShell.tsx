'use client';

import { MobileNav } from '@/components/dashboard/MobileNav';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { TopNav } from '@/components/dashboard/TopNav';

import { AgencyStatus, type AgencyView } from './AgencyStatus';

/**
 * The same staff shell as the dashboard: black sidebar, light canvas.
 * The preview route is outside the dashboard layout so it does not bounce
 * to organization setup when there is no signed-in session.
 */
export function AgencyPreviewShell({ view }: { view: AgencyView }) {
    return (
        <div className="staff-canvas flex h-screen overflow-hidden bg-background text-foreground">
            <Sidebar />
            <MobileNav />
            <div className="flex min-w-0 flex-1 flex-col">
                <TopNav />
                <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-20 pt-[calc(3.5rem+1rem)] sm:p-6 lg:p-8 lg:pb-8 lg:pt-8">
                    <AgencyStatus view={view} />
                </main>
            </div>
        </div>
    );
}
