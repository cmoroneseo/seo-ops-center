# Roll out stored page keys for rest-of-site position

1. Apply migration `141` through the Supabase migration runner, with the run ending at `141`. It adds nullable columns and installs the ingest trigger and RPC fallback. If the 5-second lock timeout fires, wait for the blocking transaction to clear and rerun `141`.
2. After owner approval, run the `CREATE INDEX CONCURRENTLY` statement from migration `142` on its own in an autocommit SQL session. Check `indisvalid` with the query below before recording `142` as applied in Supabase's migration history. The concurrent build allows reads and writes.
3. As `service_role` or the database owner, run each `CALL` as a standalone statement outside an explicit transaction. Each batch commits independently. PostgreSQL applies `statement_timeout` to the whole `CALL`, so size `p_batch_size * p_max_batches` to finish well under the production timeout of 2 minutes. Start with `p_after_id => NULL` and adjust the example batch settings to fit that budget.

   ```sql
   call public.run_gsc_history_page_key_backfill(p_after_id => null, p_batch_size => 2000, p_max_batches => 25);
   ```

   The notice reports completed batches, rows updated, and the last ID. Pass that ID as `p_after_id` on the next call. After a timeout or interruption, resume from the last ID you received, or use `NULL` if no call has reported one yet.

4. Between calls, check active `pg_stat_activity` wait events and ungranted `pg_locks` in a separate session. If ingest is waiting on locks, let the blockers clear and resume with fewer or smaller batches. When a resumed call reports zero rows, finish with a call using `p_after_id => NULL` to sweep rows skipped by `SKIP LOCKED`. Then use the count query below to confirm zero remaining page rows with a null `page_gbp_tagged`. If any remain, let any locks clear and repeat the sweep and count until the count is zero.

   ```sql
   select pid, wait_event_type, wait_event, left(query, 160) as query
   from pg_stat_activity
   where datname = current_database() and state = 'active' and wait_event is not null;

   select l.pid, l.locktype, l.relation::regclass as relation, l.mode, pg_blocking_pids(l.pid) as blockers
   from pg_locks l join pg_stat_activity a on a.pid = l.pid
   where a.datname = current_database() and not l.granted;

   select count(*) from public.gsc_history_facts where grain = 'page' and page_gbp_tagged is null;
   ```

5. Run `EXPLAIN (ANALYZE, BUFFERS)` on the RPC's inner `SELECT` from `141` with representative organization, client, property, day IDs, and excluded keys. Inspect the page-fact access path, execution time, and buffer usage. Explaining the inner query exposes the scan behind the RPC's function scan.

## Recover an invalid index

```sql
select indisvalid from pg_index
where indexrelid = to_regclass('public.gsc_history_facts_page_key_day_idx');
```

If `indisvalid` is false, run the following statement by itself in autocommit, then retry `142`. If the query returns no row, retry the create directly.

```sql
drop index concurrently if exists public.gsc_history_facts_page_key_day_idx;
```

## Rollback

Stop issuing backfill calls and let the current call finish. Restore migration `140`'s `seo_change_rest_position` function body first. Drop the `gsc_history_facts_set_page_key` trigger, then drop `set_gsc_history_page_key()`, `run_gsc_history_page_key_backfill(bigint, integer, integer)`, `backfill_gsc_history_page_key_batch(bigint, integer)`, `seo_change_page_key(text)`, and `seo_change_page_gbp_tagged(text)` from `public`. Retain the URL decoder used by `140`. Drop the index with the standalone statement above. Column drops are metadata-only on Supabase Free. Leave the two nullable columns in place to avoid another table lock.
