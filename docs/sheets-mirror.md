# Client sheet mirror

The mirror publishes client roadmap initiatives and SEO Plan tasks to the saved Client SEO sheet. It writes the three tabs named `App – Roadmap`, `App – SEO Plan tasks`, and `App – Sync info`. Each overwrite keeps one pre-sync copy of each existing mirror tab with a ` (prev)` suffix. Use a separate spreadsheet for each client and reserve these six tab names for the app.

## Enablement

1. Have the project owner review and apply migration 135.
2. Enable the Google Sheets API in the Google Cloud project that owns the existing service account configured in `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. Share each linked spreadsheet with the service account email as **Editor**.
4. Set `SHEETS_MIRROR_ENABLED=true`. The existing `CRON_SECRET` authenticates the daily cron and signs its queue messages. Basecamp links use the existing `BASECAMP_ACCOUNT_ID` when configured.

Set the sheet link in **Workspace → Integrations → Google Sheets**. In the same panel, staff with owner, admin, or member access can use **Sync now** once every two minutes per client. **Recent syncs** shows the last ten attempts in Pacific time. Counts exclude headers.

The cron starts at 11:30 UTC and processes active and onboarding clients one at a time.

To pause scheduled and manual syncs, remove `SHEETS_MIRROR_ENABLED` or set it to a value other than `true`. If a run fails after clearing mirror values, the pre-sync copies retain the previous data. Inspect those copies before starting another sync, since the next overwrite replaces them.
