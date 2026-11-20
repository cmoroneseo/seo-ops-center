const timeFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'medium',
});

export function formatPacificTime(value: string | Date): string {
    return `${timeFormat.format(new Date(value))} PT`;
}
