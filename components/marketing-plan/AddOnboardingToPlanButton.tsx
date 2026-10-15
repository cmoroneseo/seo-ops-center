'use client';

import { useState } from 'react';
import { addImportedOnboardingToPlan } from '@/lib/seo-plan/add-onboarding-to-plan';

export function AddOnboardingToPlanButton({
    clientId,
    organizationId,
    onlyBasecampTodoIds,
    onDone,
    className = '',
}: {
    clientId: string;
    organizationId: string;
    /** Limit the add to these imported to-do ids. Omit to add every unlinked onboarding to-do. */
    onlyBasecampTodoIds?: number[];
    onDone?: () => void;
    className?: string;
}) {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    return (
        <div className={className}>
            <button
                type="button"
                disabled={busy}
                onClick={async () => {
                    setBusy(true);
                    setError('');
                    setMessage('');
                    try {
                        const result = await addImportedOnboardingToPlan({
                            clientId,
                            organizationId,
                            onlyBasecampTodoIds,
                        });
                        if (!result.ok) {
                            setError(result.message);
                            return;
                        }
                        setMessage(result.summary);
                        if (result.linked + result.created > 0) onDone?.();
                    } catch (caught) {
                        setError(caught instanceof Error ? caught.message : 'Could not add onboarding to the SEO Plan');
                    } finally {
                        setBusy(false);
                    }
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
                {busy ? 'Adding…' : 'Add onboarding to SEO Plan'}
            </button>
            {message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}
            {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
    );
}
