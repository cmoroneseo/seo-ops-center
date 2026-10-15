# Bot API and Google token encryption

Read-only machine access to stored GA4 and Search Console totals, plus encryption of Google OAuth tokens that already live in `client_integrations.credentials`.

This change does not apply the migration. Apply `migrations/100_bot_api_tokens.sql` yourself before using the bot endpoints.

## Threat model

| Risk | What this does |
| --- | --- |
| Database leak of `bot_tokens` | The bearer is not stored. The row has a lookup prefix and the SHA-256 of the full token. Comparison is constant time. |
| Stolen bot bearer | The token is read-only (`ga4.read`, `gsc.read`), bound to one organization, optionally to a client allowlist, expirable, and revocable. Each call is rate limited and written to `bot_api_audit`. |
| Bot token used as a user session | Middleware does not treat `/api/bot/ga4` or `/api/bot/gsc` as a logged-in user. The routes accept only this bearer. |
| Cross-organization read | The client is loaded with the token's organization id. A client in another org is not found. The request cannot name an organization. |
| Audit or response leaks secrets | The audit row stores token id, prefix, route, client id, HTTP status, and an error code. It does not store the bearer, Google tokens, or request headers. Responses are metric totals and a property id. |
| Database leak of `client_integrations.credentials` | `access_token` and `refresh_token` are AES-256-GCM envelopes when `GOOGLE_TOKEN_ENC_KEY` is set. The key stays in the host environment. Property ids, site URLs, scopes, and the account email stay plaintext so existing queries keep working. |
| Ciphertext swapped between fields | Associated data is `seo-ops.google-token.v1.access_token` or `...refresh_token`. A swapped envelope does not decrypt. |
| Old plaintext rows during rollout | Readers still accept a legacy string. New writes seal when the key is configured. The backfill is idempotent and non-destructive. |
| Browser session minting tokens | Issuing, listing, and revoking require an owner or admin of that organization. Inserts and updates run with the service role after that check. Authenticated users are not granted `token_hash`. |
| Encryption key missing at deploy | Sealing is skipped only when the key is unset, which leaves legacy plaintext. Set the key before deploying this code. |

## Call contract

Both routes are `GET`, unauthenticated by session cookie, and require:

```http
Authorization: Bearer socbot_<prefix>_<secret>
```

The prefix is 12 characters from the token string. The secret is never shown again after issue.

### `GET /api/bot/ga4`

### `GET /api/bot/gsc`

Query string, exactly one mode:

- `clientId=<uuid>&start=YYYY-MM-DD&end=YYYY-MM-DD`
- `clientId=<uuid>&range=7d|28d|90d`

Optional `source=stored` (default) or `source=live`.

Rules:

- `start` and `end` are inclusive UTC dates. `end` cannot be after today UTC.
- A preset range ends today UTC. `7d` is seven days including today.
- The span cannot exceed 400 days.
- Unknown parameters and duplicate parameters are rejected.
- `stored` reads `ga4_history_days` / `ga4_daily`, or `gsc_history_days` / `gsc_history_facts` where `grain = 'property'`.
- `live` calls Google with the client's stored OAuth token via `getGoogleAccessToken`. It does not write history.
- Missing stored days are not treated as zero. Totals are `null` and `incomplete` is true when coverage is short.
- A live Google response with no rows is a measured zero.
- If several properties are stored and the client has none selected, the response is `409`.

`200` GA4 body:

```json
{
  "source": "stored",
  "granularity": "day",
  "clientId": "00000000-0000-4000-8000-000000000000",
  "start": "2026-10-01",
  "end": "2026-10-07",
  "property": "properties/123",
  "expectedDays": 7,
  "coverageDays": 7,
  "incomplete": false,
  "totals": {
    "organicSessions": 10,
    "sessions": 20,
    "engagedSessions": 8,
    "keyEvents": 3
  }
}
```

`200` Search Console body uses the same envelope. `totals` is `clicks`, `impressions`, `ctr`, and impression-weighted `position`.

Live responses set `"source": "live"`, `"granularity": "range"`, and `"coverageDays": null`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid query. `{ "error": "Invalid query", "issues": [{ "path": "start", "message": "Invalid value" }] }` |
| 401 | Missing, unknown, expired, or revoked token, or Google needs reconnect on a live read. |
| 403 | Token scope does not include this route, or the client is outside the allowlist. |
| 404 | Client is not in the token's organization, or the integration is not connected on a live read. |
| 409 | More than one stored property and none is selected on the client. |
| 429 | Per-token limit. `Retry-After` and `retryAfterSeconds` are set. |
| 502 / 503 | Google or the local store failed. The body does not include the upstream payload. |

Successful and limited responses include `X-RateLimit-Limit` and `X-RateLimit-Remaining`. Every response sends `Cache-Control: no-store`.

Example:

```bash
curl -sS \
  -H "Authorization: Bearer $BOT_TOKEN" \
  "https://seo-ops-center.vercel.app/api/bot/gsc?clientId=CLIENT_UUID&range=28d"
```

## Issue and revoke

Owners and admins use **Settings → Bots** (`/settings?tab=bots`).

- Issue asks for a name, scopes, optional client allowlist, expiry (30, 90, 365 days, or none), and a per-minute limit (1–600, default 60).
- The plaintext token is returned once. The database stores `token_prefix` and `token_hash` only.
- Revoke sets `revoked_at`. A revoked token cannot read, and it does not consume quota.
- Empty allowlist means every client in the organization. A non-empty list is checked against that organization at issue time.

HTTP equivalents, cookie session, owner or admin:

```http
GET  /api/settings/bot-tokens?organizationId=<uuid>
POST /api/settings/bot-tokens
POST /api/settings/bot-tokens/revoke
```

`POST` issue body:

```json
{
  "organizationId": "<uuid>",
  "name": "Weekly digest",
  "scopes": ["ga4.read", "gsc.read"],
  "clientIds": [],
  "expiresAt": "2027-01-15T00:00:00.000Z",
  "rateLimitPerMinute": 60
}
```

Omit `expiresAt` for 90 days. Send `"expiresAt": null` for no expiry. The `201` body is `{ "token": "<plaintext once>", "bot": { ...metadata } }`. List and revoke bodies have no `token` field.

## Key rotation

`GOOGLE_TOKEN_ENC_KEY` forms:

- One 32-byte key, base64 or base64url. Its kid is `1`.
- A ring: `k2:<material>,k1:<material>`. The first kid is used for new writes. Later kids decrypt older envelopes.
- `GOOGLE_TOKEN_ENC_KEY_ID` overrides the current kid. It must already be in the ring.

Envelopes look like `{ "enc": "aes-256-gcm", "v": 1, "kid": "k2", "iv": "...", "tag": "...", "ct": "..." }` and replace the string token in the JSON object. Other credential keys are unchanged.

To rotate:

1. Generate a new 32-byte key.
2. Put it first in `GOOGLE_TOKEN_ENC_KEY` and keep the previous kid in the same value.
3. Deploy.
4. Run the backfill with `--commit` so old envelopes are rewritten under the new kid.
5. After verify reports no `rotate` rows, a later deploy may drop the old kid. Do not drop it while any row still uses it.

## Deploy order

1. Set `GOOGLE_TOKEN_ENC_KEY` (and `GOOGLE_TOKEN_ENC_KEY_ID` if you use it) in the host environment. Do this before the deploy that starts sealing writes.
2. Apply `migrations/100_bot_api_tokens.sql`. This pull request does not apply it. The encryption code does not require the new tables; the bot routes and Settings tab do.
3. Deploy.
4. Dry-run the backfill, then commit, then verify.
5. Issue a bot token and call one stored endpoint and, if you want, one `source=live` endpoint.

Backfill (service role, dry-run unless `--commit`):

```bash
node scripts/encrypt-google-tokens.mjs --dry-run --org <organization-uuid>
node scripts/encrypt-google-tokens.mjs --commit --verify --org <organization-uuid>
```

The same job is `POST /api/admin/google-token-encryption` as an owner or admin. `dryRun` defaults to true.

```json
{ "organizationId": "<uuid>", "dryRun": false, "verify": true }
```

Verify opens the stored envelopes and checks the token strings still match the values from before the write. The report is counts and codes (`key_missing`, `invalid`, `conflict`, `verify_failed`, `decrypt_failed`). It does not print tokens. Run it again after a successful commit: `updated` should be `0`.

A conflict means another writer changed the row during the update. The compare-and-swap keeps that writer's credentials. Run the backfill again.
