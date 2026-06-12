## Summary

- 

## Security Review

- [ ] I ran `npm run lint`.
- [ ] I ran `npm run typecheck`.
- [ ] I ran `npm run build`.
- [ ] I ran `npm run security:all`.
- [ ] This PR does not add or expose secrets.
- [ ] This PR does not trust browser-provided `orgId`, `clientId`, `userId`, `role`, or `connectedBy` without server-side authorization.
- [ ] Logs and client responses are redacted and do not include sensitive data.

## Sensitive Areas Touched

- [ ] `app/api/**`
- [ ] `app/auth/**`
- [ ] `middleware.ts`
- [ ] `lib/supabase/**`
- [ ] `migrations/**` or `schema.sql`
- [ ] `.env.example` or env usage
- [ ] `package*.json`
- [ ] `vercel.json` or `.github/**`
- [ ] None of the above

## Security Notes

Describe any auth, authorization, RLS, service-role, webhook, OAuth, dependency, migration, storage, logging, or privacy impact:

- 

## Tests

- 
