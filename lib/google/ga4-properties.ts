export interface Ga4PropertySummary {
    id: string;
    displayName: string;
    account: string;
}

/** Numeric id, with the Analytics Admin `properties/` prefix removed. */
export function ga4PropertyId(id: string): string {
    return id.replace(/^properties\//, '');
}

/**
 * Case-insensitive match on display name, account name, and property id.
 * Order is unchanged. A leading "ID:" is ignored so a pasted label still matches.
 * Selection stays with the caller; this never clears it.
 */
export function filterGa4Properties<T extends Ga4PropertySummary>(properties: T[], query: string): T[] {
    const needle = query.trim().toLowerCase().replace(/^id:\s*/, '');
    if (!needle) return properties;
    return properties.filter(property => {
        const numericId = ga4PropertyId(property.id);
        return [property.displayName, property.account, property.id, numericId]
            .some(field => field.toLowerCase().includes(needle));
    });
}

export function ga4SearchEmptyMessage(query: string): string {
    return `No properties match "${query.trim()}"`;
}
