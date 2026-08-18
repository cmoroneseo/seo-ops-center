type DeleteTimeLogAcrossSystemsOptions = {
    basecampEntryId?: string | number | null;
    removeBasecampEntry: () => Promise<Response>;
    removeLocalEntry: () => Promise<void>;
};

async function removalError(response: Response): Promise<string> {
    try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === 'string' && body.error.trim()) return body.error;
    } catch {
        // Fall through to a stable message when the upstream response is not JSON.
    }
    return `Couldn't remove the Basecamp time entry (${response.status}). Try again.`;
}

/**
 * Delete the external entry first. The local row is the retry handle, so it
 * must remain intact whenever Basecamp rejects or cannot receive the request.
 */
export async function deleteTimeLogAcrossSystems(
    options: DeleteTimeLogAcrossSystemsOptions,
): Promise<{ success: boolean; error?: string }> {
    try {
        if (options.basecampEntryId) {
            const response = await options.removeBasecampEntry();
            if (!response.ok) {
                return { success: false, error: await removalError(response) };
            }
        }
        await options.removeLocalEntry();
        return { success: true };
    } catch (error: unknown) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Could not delete the time entry.',
        };
    }
}
