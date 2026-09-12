export type IdentityDecisionResponseResult =
    | { kind: 'saved' }
    | { kind: 'failed'; message: string }
    | { kind: 'conflict_refreshed'; message: string }
    | { kind: 'conflict_refresh_failed' };

interface IdentityDecisionResponseDependencies {
    invalidateConflict(): void;
    refresh(): Promise<boolean>;
}

export async function processIdentityDecisionResponse(
    response: Response,
    dependencies: IdentityDecisionResponseDependencies,
): Promise<IdentityDecisionResponseResult> {
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.status === 409) {
        dependencies.invalidateConflict();
        const refreshed = await dependencies.refresh();
        return refreshed
            ? {
                kind: 'conflict_refreshed',
                message: 'Identity evidence or claim state changed and was refreshed. Review the current state before trying again.',
            }
            : { kind: 'conflict_refresh_failed' };
    }
    if (!response.ok) {
        return {
            kind: 'failed',
            message: body.error || 'Unable to save the site identity decision.',
        };
    }
    await dependencies.refresh();
    return { kind: 'saved' };
}
