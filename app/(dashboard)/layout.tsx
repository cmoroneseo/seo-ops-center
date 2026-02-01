'use client';

import { Sidebar } from '@/components/dashboard/Sidebar';
import { ClientListPanel } from '@/components/workspace/ClientListPanel';
import { useOrganization } from '@/components/providers/organization-provider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { organization, isLoading } = useOrganization();
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
        <div className="flex h-screen overflow-hidden bg-background">
            {!isSetupPage && <Sidebar />}
            {showProjectSidebar && <ClientListPanel />}
            <main className={cn(
                "flex-1 flex flex-col min-w-0",
                isSetupPage ? "flex items-center justify-center" : (showProjectSidebar ? "" : "p-8 overflow-y-auto")
            )}>
                {children}
            </main>
            {!isSetupPage && <OnboardingChecklist />}
        </div>
    );
}
