import { Suspense } from 'react';

import { ExampleGallery } from '@/components/change-log/ExampleGallery';

export const dynamic = 'force-dynamic';

/** Labeled example screens. Not a client record and not written to the database. */
export default function ChangeLogExamplePage() {
    return (
        <div className="staff-canvas min-h-screen p-4 sm:p-8">
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading example…</p>}>
                <ExampleGallery />
            </Suspense>
        </div>
    );
}
