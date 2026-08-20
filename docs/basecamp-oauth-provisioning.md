# Basecamp OAuth credential provisioning

The application authenticates OAuth initiation and consumes callback state from
the durable `basecamp_oauth_states` ledger. It intentionally does not persist or
display the access and refresh tokens returned by Basecamp because this repository
has no encrypted credential store.

Production credentials remain operator-managed environment secrets. After an
authorized operator obtains the credentials through the organization's approved
OAuth client or credential broker, provision them without placing values in source
control or browser output:

```sh
vercel env add BASECAMP_ACCESS_TOKEN production
vercel env add BASECAMP_REFRESH_TOKEN production
vercel env add BASECAMP_ACCOUNT_ID production
```

Repeat for `preview` when that environment is authorized to use Basecamp. Apply
`migrations/032_close_identity_and_provider_provenance.sql` before enabling the
connect route. The callback exchanges a valid code only to verify the flow, then
fails closed with a generic operator-provisioning message and discards the token
response. Credential rotation therefore requires repeating this controlled secret
provisioning process; tokens must never be copied into tickets, logs, or committed
files.
