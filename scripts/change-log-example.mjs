#!/usr/bin/env node
/**
 * Prints the Ecoworkz homepage main heading example.
 * Does not connect to a database and does not insert a row.
 * The live numbers in the app's example screen are synthetic.
 * Apply migration 125 separately, then log the change in the product.
 */

const args = new Set(process.argv.slice(2));
if (args.has('--insert') || args.has('--apply')) {
    console.error('Refusing to insert or apply anything. Log the change in the app after migration 125 is applied.');
    process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
if (url && !/localhost|127\.0\.0\.1/.test(url)) {
    console.error('This script does not write. A non-local Supabase URL is set, so it will not continue.');
    process.exit(1);
}

const seed = {
    client: 'Ecoworkz',
    page: 'https://www.ecoworkz.net/',
    cmsPageId: '7901',
    cmsWidgetId: '47eaa58',
    changeType: 'h1',
    before: 'Hardscape, Landscape & Outdoor Living Contractors in Corona, CA',
    after: 'Hardscape & Landscape Contractors in Corona, CA',
    liveAtPacific: '2026-11-10T14:04',
    approvedBy: 'Carlos',
    backup: 'Saved copy of the old homepage heading',
    revert: 'Put the main heading back to: Hardscape, Landscape & Outdoor Living Contractors in Corona, CA.',
    queries: ['hardscape contractors corona', 'landscape contractors corona', 'corona landscaping'],
    gscProperty: 'sc-domain:ecoworkz.net',
    ga4Property: 'properties/296973560',
    overlap: 'El Niño promo went live the same day at 1:28 PM PT. Log it separately so it shows as a confounder.',
    note: 'Do not insert this into production from this script. Example performance numbers live in lib/change-log/fixture.ts and are labeled in the UI.',
};

console.log(JSON.stringify(seed, null, 2));
