export function priorityUpdatesSucceeded(
    responses: { error: unknown }[],
): boolean {
    return responses.every(({ error }) => !error);
}
