# Client SEO sheet backfill

Set or remove an individual client’s roadmap sheet link in **Workspace → Integrations → Google Sheets**.

Migration 133 and the backfill SQL are prepared for review. Migration 133 is unapplied, and the backfill has never been run.

The backfill requires Carlos's explicit approval and migration 133 applied first. Review the eligible clients and proposed links using the opening SELECT before running the full transaction. The update fills only rows where both sheet columns are null.

## One-time sheet row import

Export the Roadmap and Content Plan tabs as CSV files. Keep the original sheet
row numbers by exporting whole tabs, including the Roadmap preamble. The
manifest lists the only rows included in the review.

```json
{
  "clients": [{
    "clientId": "11111111-1111-4111-8111-111111111111",
    "clientName": "Example Client",
    "organizationId": "22222222-2222-4222-8222-222222222222",
    "marketingPlanId": null,
    "launchDate": "2026-08-06",
    "sheetId": "abcdefghijklmnopqrstuvwxyz",
    "tabs": { "Roadmap": "roadmap.csv", "Content Plan": "content.csv" },
    "rows": [
      { "tab": "Roadmap", "row": 7, "action": "create" },
      { "tab": "Content Plan", "row": 3, "action": "skip", "coveredBy": "existing-task-id" }
    ],
    "existing": { "planItems": [], "tasks": [] }
  }]
}
```

Tab paths are relative to the manifest. Include existing plan item and task
IDs and titles in the manifest to check for possible duplicates.

```sh
npx tsx scripts/sheets/import-sheet-rows.ts preview --manifest manifest.json --out preview.csv
```

Carlos reviews each row, including flagged title matches, and fills the
`approve` column with `Y` or `YES` for approved creates. Save as
`approved.csv` with the headers and CSV quoting intact.

```sh
npx tsx scripts/sheets/import-sheet-rows.ts apply --preview approved.csv
```

Dry run prints the pending inserts. With Supabase admin environment variables
available, it reads existing import keys and plan ordering. Without them it
runs offline and reports candidates before those checks. The CLI resolves
organization and existing plan IDs from the client record at apply time.

Execute only after Carlos gives explicit approval and separately applies
migration 134. Supply `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in the process environment. Use the approved
create count for `--confirm` and the user UUID for task attribution.

```sh
npx tsx scripts/sheets/import-sheet-rows.ts apply --preview approved.csv --execute --confirm "1" --actor "USER_UUID"
```

An approved roadmap row can create the client's SEO Plan if needed. Roadmap
items and content tasks use per-client import keys to skip rows already
inserted. If execution is interrupted, rerun the same approved CSV. The importer
makes no Basecamp calls.

The separate Swing Inn rename script, `rename_inactive_swing_inn.sql`, is
prepared and has never been run. It requires Carlos's explicit approval before
execution.
