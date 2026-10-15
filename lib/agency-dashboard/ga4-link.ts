/** Opens the existing GA4 property picker on the client integrations tab. */

export function ga4PropertyPickerHref(clientId: string): string {
    return `/workspace/${clientId}?tab=integrations&picker=ga4`;
}

export function ga4PickerRequested(value: string | null | undefined): boolean {
    return value === 'ga4';
}
