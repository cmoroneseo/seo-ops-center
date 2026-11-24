# Scoped SEO test data re-pull

The re-pull is **not planned after merge**. Let the normal GSC and GA4 workers repair the stored data first. On change detail open, a saved partial baseline advances whenever more final baseline days are available. A complete baseline stays frozen.

The GSC daily worker can also re-check one older final day per invocation when the claimed connection has finished its incomplete, recent, and missing work and the worker has spare time. It looks outside the newest seven Pacific dates and within the newest 90, picks the oldest import for that connection, and requires at least seven days since the last import. The re-check uses a 100 ms gap between Google requests and does not schedule a continuation. Older final-day revisions can take longer than the first verification window to reach.

## Verify after 24–48 hours

Use read-only queries to check the current properties for `gsc_history_days` with `is_incomplete = true` and `ga4_history_days` with `is_final = false` on dates older than three days. Use Pacific dates for GSC and UTC dates for GA4. Check for missing dates as well, and compare the flagged Ecoworkz GSC clicks and GA4 organic sessions against the corresponding Google reports. Keep the re-pull unused if the workers resolve the gaps.

## Preview and run only if gaps remain

From the repository root, use Node 20.6 or later and the installed repository dependencies. Load `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the intended project through your usual secrets workflow. Set `ECOWORKZ_CLIENT_ID` to the full Ecoworkz client UUID. Start with the scoped dry run.

```sh
node --conditions=react-server --import tsx scripts/seo-test-data-repull.ts --client "$ECOWORKZ_CLIENT_ID"
```

The default dry run only issues database SELECTs. It lists matched active or errored connections, their date ranges, and the stored GSC grains and day counts. It needs no Google calls or OAuth credentials. Repeat `--client <uuid>` to select multiple clients, and add `--service gsc` or `--service ga4` if only one service needs repair. The windows cover the last 30 completed Pacific dates for GSC and the last 30 completed UTC dates for GA4.

**Every write run requires Carlos's explicit yes**, including retries or wider runs. With that approval, run Ecoworkz alone first, using the same filters as the preview. Load `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. For GSC writes, set `GSC_HISTORY_V2_ENABLED` explicitly to the deployed GSC worker value (`true` or `false`).

```sh
node --conditions=react-server --import tsx scripts/seo-test-data-repull.ts --client "$ECOWORKZ_CLIENT_ID" --write
```

Before pulling a GSC connection, the script compares the flag with each stored day in scope. Any v2-specific device, country, or organic-page grain identifies a v2 day. A day with only legacy grains is classified as v1, and days with no facts are compatible with either setting. An incompatible day blocks the entire connection, so a window with both versions is refused under either flag.

Writes replace GSC history days and their facts, or GA4 history days, daily totals, and landing-page rows. OAuth can refresh stored credentials or mark a connection as needing reauthorization. The command reports safe failure reasons by connection and exits nonzero if any connection fails. Days saved before a failure stay saved.

Compare Ecoworkz's stored daily totals and page metrics with the Google reports after the write. Widen only if the comparison comes back as expected, other clients still have confirmed gaps, and Carlos explicitly approves the next write run. Dry run the exact wider scope first.
