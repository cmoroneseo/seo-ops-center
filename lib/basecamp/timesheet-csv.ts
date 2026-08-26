import { createHash } from 'node:crypto';

/**
 * Basecamp timesheet CSV export.
 *
 * This is the accurate source for a backfill. The JSON endpoint
 * `/projects/{id}/timesheet.json` repeats its entries on every page of its
 * Link-header pagination, so a naive sweep multiplies hours; the CSV report
 * does not, and it filters by person and date range server-side.
 *
 * Its cost is identity: the export carries no entry id and names the project
 * rather than identifying it. `fingerprintFor` supplies a stand-in key.
 */

/**
 * The five fields that make up a timesheet entry's stand-in identity.
 *
 * Both import paths hash exactly this shape through `fingerprintFor`, which is
 * the whole point: the CSV backfill builds it from a `CsvTimesheetRow`, and the
 * live webhook builds it from the provider entry it read back over OAuth. If
 * the two ever diverged, the same Basecamp entry would produce two identities
 * and the client would be billed twice.
 */
export interface TimesheetIdentityInput {
    /** Display name of the person the time belongs to. */
    person: string;
    /** Display name of the Basecamp project (bucket). */
    projectName: string;
    /** yyyy-MM-dd */
    date: string;
    /** Parsed hours. The API sends `"2.0"` as a string; parse before hashing. */
    hours: number;
    /** ISO instant the entry was created, in either source's precision. */
    created: string;
}

export interface CsvTimesheetRow extends TimesheetIdentityInput {
    /** To-do title when the entry hangs off one; empty for project-level time. */
    item: string;
    notes: string;
}

const EXPECTED_FIELDS = 7;

/** Split one CSV line, honoring quoted fields and doubled escaped quotes. */
function splitLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === ',' && !quoted) {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);
    return fields;
}

export function parseTimesheetCsv(text: string): CsvTimesheetRow[] {
    const lines = text.split('\n').map(line => line.replace(/\r$/, ''));
    const rows: CsvTimesheetRow[] = [];

    for (const line of lines.slice(1)) {
        if (!line.trim()) continue;

        const fields = splitLine(line);
        if (fields.length !== EXPECTED_FIELDS) continue;

        const hours = Number(fields[2]);
        // A row we cannot read is skipped, never imported as zero hours.
        if (!Number.isFinite(hours)) continue;

        rows.push({
            date: fields[0].trim(),
            person: fields[1].trim(),
            hours,
            projectName: fields[3].trim(),
            item: fields[4].trim(),
            notes: fields[5].trim(),
            created: fields[6].trim(),
        });
    }

    return rows;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * One instant, one spelling: second-precision UTC.
 *
 * The CSV export writes `2026-08-17T01:47:31Z` while the API writes
 * `2026-08-21T21:46:54.268Z` for the same kind of value. Hashing them raw makes
 * the same entry produce two different fingerprints, so a webhook would insert
 * a duplicate row beside the one a backfill already created instead of adopting
 * it. Truncating (never rounding) to seconds is what the two sources agree on.
 *
 * Anything that is not an ISO-8601 instant is returned untouched: collapsing
 * unparseable values to a shared constant would make unrelated rows collide on
 * the fingerprint's unique index.
 */
export function normalizeCreatedAt(created: string): string {
    if (!ISO_INSTANT.test(created)) return created;
    const parsed = new Date(created);
    if (Number.isNaN(parsed.getTime())) return created;
    return `${parsed.toISOString().slice(0, 19)}Z`;
}

/**
 * Stand-in identity for a CSV row.
 *
 * Deliberately excludes `notes` and `item`: both can be edited in Basecamp
 * after the fact, and an identity that changes when someone fixes a typo would
 * import a duplicate. Date + hours + project + created is unique across every
 * row measured, and `created` alone is near-unique.
 */
export function fingerprintFor(row: TimesheetIdentityInput): string {
    // Netstring-style length-prefixing (`<byteLength>:<value>`) so no field's
    // content — however many `|` or `:` characters it contains — can shift a
    // boundary and collide with a different split of the same total bytes.
    const key = [
        row.person,
        row.projectName,
        row.date,
        String(row.hours),
        normalizeCreatedAt(row.created),
    ]
        .map(field => `${Buffer.byteLength(field, 'utf8')}:${field}`)
        .join('');
    return createHash('sha256').update(key).digest('hex').slice(0, 32);
}
