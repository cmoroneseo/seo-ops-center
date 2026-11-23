# One-time SEO test data re-pull

After the data accuracy PR is merged, Carlos can run this from the repository root with Node 20.6 or later and the repository dependencies installed. Preview the two date windows first. The preview uses the local clock and makes no network requests.

```sh
node --conditions=react-server --import tsx scripts/seo-test-data-repull.ts
```

Load `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` for the intended project into the shell using your usual secrets workflow. Set `GSC_HISTORY_V2_ENABLED` to the deployed GSC sync value (`true` or `false`) so the re-pull uses the same fact grains. Then run the same command with the explicit write flag.

```sh
node --conditions=react-server --import tsx scripts/seo-test-data-repull.ts --write
```

The command processes active and errored GSC and GA4 connections across all clients. It fetches the last 30 completed Pacific dates for GSC and the last 30 completed UTC dates for GA4. It replaces GSC history day rows and their facts, plus GA4 history days, daily totals, and landing-page rows. The existing OAuth helper can refresh stored credentials or mark a connection as needing reauthorization. The command also replaces stored zero-traffic days in that window. A partial baseline refreshes when its change detail is opened after all baseline days are final.

The script runs independently of deployments and the normal cron. It logs a result per connection and exits nonzero if any connection fails. Completed days stay saved if a connection stops partway through. Resolve failed connections or wait for quota to reset, then run the write command again to retry the current 30-day windows.
