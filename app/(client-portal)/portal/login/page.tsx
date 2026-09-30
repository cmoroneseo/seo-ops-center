import { Suspense } from 'react';
import { PortalLoginForm } from '@/components/portal/PortalLoginForm';

export const metadata = {
    title: 'Client portal sign in',
    robots: { index: false, follow: false },
};

export default function PortalLoginPage() {
    return (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
            <PortalLoginForm />
        </Suspense>
    );
}
