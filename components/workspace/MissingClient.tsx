import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/** Shown when the open client URL is outside the active organization. */
export function MissingClient({ organizationName }: { organizationName?: string | null }) {
    const org = organizationName?.trim() || 'this organization';
    return (
        <div className="mx-auto flex min-h-[24rem] max-w-lg flex-col items-center justify-center px-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Client not found</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                This link points to a client outside {org}. Choose a client from the list for this organization.
            </p>
            <Link
                href="/workspace"
                className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to clients
            </Link>
        </div>
    );
}
