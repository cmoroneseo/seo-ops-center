'use client';

import { Sidebar } from '@/components/dashboard/Sidebar';
import { MobileNav } from '@/components/dashboard/MobileNav';
import { TopNav } from '@/components/dashboard/TopNav';
import { ClientListPanel } from '@/components/workspace/ClientListPanel';
import { useOrganization } from '@/components/providers/organization-provider';
import { TimerProvider } from '@/components/providers/timer-provider';
import { ToastGateProvider } from '@/components/providers/toast-gate';
import { TimerNotifications } from '@/components/timer/TimerNotifications';
import { FloatingTimer } from '@/components/timer/FloatingTimer';
import { useClients } from '@/lib/hooks/use-clients';
import { useRouter, usePathname } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { NotepadPanel } from '@/components/notepad/NotepadPanel';
import { RemindersPanel } from '@/components/reminders/RemindersPanel';

export function DashboardShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const { organization, isLoading } = useOrganization();
    const { clients } = useClients({ statuses: ['Active'] });
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (!isLoading && !organization && !pathname.startsWith('/setup-organization')) {
            router.push('/setup-organization');
        }
    }, [organization, isLoading, router, pathname]);

    if (isLoading) {
        return <DashboardLoadingSkeleton />;
    }

    if (!organization && !pathname.startsWith('/setup-organization')) {
        return null; // Redirecting
    }

    const isSetupPage = pathname.startsWith('/setup-organization');
    const isWorkspace = pathname.startsWith('/workspace');
    const isTasks = pathname.startsWith('/tasks');
    const isPlanner = pathname.startsWith('/planner');
    const isCloseBoard = pathname.startsWith('/reports/close');
    const isTraining = pathname.startsWith('/training');
    const isDashboard = pathname === '/dashboard';
    const showProjectSidebar = !isSetupPage && (isWorkspace || isTasks || isDashboard);

    return (
        <TimerProvider>
            <ToastGateProvider>
            <div className="flex h-screen overflow-hidden bg-background">
                {!isSetupPage && <Sidebar />}
                {!isSetupPage && <MobileNav showClientList={showProjectSidebar} />}
                <div className="flex flex-1 min-w-0 flex-col">
                    {!isSetupPage && <TopNav />}
                    <div className="flex flex-1 min-h-0">
                        {showProjectSidebar && (
                            <Suspense fallback={<ClientListFallback />}>
                                <ClientListPanel />
                            </Suspense>
                        )}
                        <main className={cn(
                            "flex-1 min-w-0 overflow-y-auto",
                            // Classic scrollbars are ~15px. Without a stable gutter, opening
                            // Roadmap or Overview shows the bar and shifts the right-aligned
                            // agreement actions. Overlay scrollbars ignore the gutter.
                            isWorkspace && "[scrollbar-gutter:stable]",
                            isSetupPage
                                ? "flex flex-col items-center justify-center"
                                // The planner manages its own scrolling and rails, so it opts out
                                // of the page padding entirely.
                                : isPlanner || isCloseBoard
                                    ? "overflow-hidden p-0 pt-14 lg:pt-0"
                                    : isTraining
                                        ? "overflow-y-auto p-0 pb-20 pt-14 lg:pb-0 lg:pt-0 xl:overflow-hidden"
                                    // Base padding, then mobile top/bottom offsets to clear the fixed bars.
                                    : "p-4 sm:p-6 lg:p-8 pt-[calc(3.5rem+1rem)] pb-20 lg:pt-8 lg:pb-8"
                        )}>
                            {children}
                        </main>
                    </div>
                </div>
                {/* OnboardingChecklist hidden until tasks are updated for public launch */}
                {/* {!isSetupPage && <OnboardingChecklist />} */}
            </div>
            {!isSetupPage && <FloatingTimer clients={clients} />}
            {!isSetupPage && <TimerNotifications />}
            {!isSetupPage && <FeedbackWidget />}
            {!isSetupPage && <NotepadPanel />}
            {!isSetupPage && <RemindersPanel />}
            </ToastGateProvider>
        </TimerProvider>
    );
}

function ClientListFallback() {
    return (
        <div className="hidden h-full w-72 flex-col border-r border-border bg-muted/30 lg:flex" aria-hidden="true">
            <div className="flex flex-1 flex-col gap-2 p-3">
                {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className="h-8 animate-pulse rounded-lg bg-muted" />
                ))}
            </div>
        </div>
    );
}

function DashboardLoadingSkeleton() {
    return (
        <div className="flex h-screen bg-background" role="status" aria-busy="true">
            <span className="sr-only">Loading</span>
            <div className="hidden w-20 border-r border-border bg-card lg:block" />
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="h-16 border-b border-border" />
                <div className="flex min-h-0 flex-1">
                    <div className="hidden w-72 border-r border-border bg-muted/30 lg:block" />
                    <div className="flex-1 space-y-6 p-8">
                        <div className="h-10 w-56 animate-pulse rounded bg-muted" />
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                            {Array.from({ length: 4 }, (_, index) => (
                                <div key={index} className="h-40 animate-pulse rounded-xl bg-muted" />
                            ))}
                        </div>
                        <div className="h-64 animate-pulse rounded-xl bg-muted" />
                    </div>
                </div>
            </div>
        </div>
    );
}
