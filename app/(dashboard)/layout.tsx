'use client';

import { Sidebar } from '@/components/dashboard/Sidebar';
import { MobileNav } from '@/components/dashboard/MobileNav';
import { ClientListPanel } from '@/components/workspace/ClientListPanel';
import { useOrganization } from '@/components/providers/organization-provider';
import { TimerProvider } from '@/components/providers/timer-provider';
import { TimerNotifications } from '@/components/timer/TimerNotifications';
import { FloatingTimer } from '@/components/timer/FloatingTimer';
import { useClients } from '@/lib/hooks/use-clients';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { organization, isLoading } = useOrganization();
    const { clients } = useClients({ statuses: ['Active'] });
    const router = useRouter();
    const pathname = usePathname();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (mounted && !isLoading && !organization && !pathname.startsWith('/setup-organization')) {
            router.push('/setup-organization');
        }
    }, [organization, isLoading, router, pathname, mounted]);

    if (!mounted || isLoading) {
        return <div className="flex h-screen items-center justify-center">Loading...</div>;
    }

    if (!organization && !pathname.startsWith('/setup-organization')) {
        return null; // Redirecting
    }

    const isSetupPage = pathname.startsWith('/setup-organization');
    const isWorkspace = pathname.startsWith('/workspace');
    const isTasks = pathname.startsWith('/tasks');
    const isDashboard = pathname === '/dashboard';
    const showProjectSidebar = !isSetupPage && (isWorkspace || isTasks || isDashboard);

    return (
        <TimerProvider>
            <div className="flex h-screen overflow-hidden bg-background">
                {!isSetupPage && <Sidebar />}
                {!isSetupPage && <MobileNav showClientList={showProjectSidebar} />}
                {showProjectSidebar && <ClientListPanel />}
                <main className={cn(
                    "flex-1 min-w-0 overflow-y-auto",
                    isSetupPage
                        ? "flex flex-col items-center justify-center"
                        // Base padding, then mobile top/bottom offsets to clear the fixed bars.
                        : "p-4 sm:p-6 lg:p-8 pt-[calc(3.5rem+1rem)] pb-20 lg:pt-8 lg:pb-8"
                )}>
                    {children}
                </main>
                {/* OnboardingChecklist hidden until tasks are updated for public launch */}
                {/* {!isSetupPage && <OnboardingChecklist />} */}
            </div>
            {!isSetupPage && <FloatingTimer clients={clients} />}
            {!isSetupPage && <TimerNotifications />}
            {!isSetupPage && <FeedbackWidget />}
        </TimerProvider>
    );
}
