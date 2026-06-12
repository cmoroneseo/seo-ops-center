# Security Checklists

## Pull Request Checklist

- Authenticated user is derived server-side from Supabase session.
- Authorization checks prove membership or admin/owner role before tenant data access.
- `orgId`, `clientId`, `userId`, `role`, and `connectedBy` from requests are treated as untrusted.
- Service-role client is used only after authorization and only in server-only code.
- API inputs are validated for type, allowed values, ownership, size, and abuse cases.
- Response payloads do not include credentials, tokens, secrets, internal errors, or unnecessary data.
- Logs redact emails, tokens, API keys, cookies, webhook bodies, provider payloads, and sensitive metadata.
- New env vars are added to `.env.example` and are correctly public or server-only.
- New dependencies are justified and reviewed for supply-chain risk.
- New migrations include RLS impact, deny cases, and rollback notes.
- Tests cover unauthorized, cross-tenant, malformed, and happy-path cases.

## GitHub

- Branch protection enabled on `main`.
- Required checks include lint, typecheck, build, security env check, static security review, secret scan, dependency review, and SAST.
- PR review required before merge.
- CODEOWNERS or required reviewers cover `.env*`, `.github/**`, `migrations/**`, `schema.sql`, `app/api/**`, `app/auth/**`, `middleware.ts`, `lib/supabase/**`, `package*.json`, and `vercel.json`.
- GitHub secret scanning and push protection enabled.
- Dependabot alerts and security updates enabled.
- Actions default permissions set to read-only, with write permissions granted only per job.

## Vercel

- Production deploys are limited to protected branches.
- Preview deployments do not use production Supabase data unless protected by access controls.
- Production env vars contain no placeholders.
- Service-role key is server-only and never prefixed with `NEXT_PUBLIC_`.
- `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`, Google OAuth secrets, and Supabase keys are set per environment.
- OAuth redirect URIs match the environment.
- Build fails if production env readiness fails.
- Logs are reviewed for sensitive data before production release.

## Supabase

- RLS enabled on every public table.
- Tenant-scoped tables use `organization_id in (select get_user_org_ids())` or stricter.
- Admin-only tables use admin/owner membership checks.
- Credential-bearing tables do not expose raw credentials to browser-readable policies.
- Service-role writes are isolated to server routes and scripts.
- `SECURITY DEFINER` functions are minimal and reviewed for safe search path behavior.
- Storage bucket policies constrain path, bucket, user, org, and ownership where possible.
- Auth redirect URLs are allowlisted.
- Cross-tenant deny tests exist for sensitive tables.

## API Routes And Webhooks

- Authenticate before processing user requests.
- Authorize tenant access before reads/writes.
- Validate payload shape, allowed enum values, IDs, month/date formats, and size limits.
- Use service role only after authorization.
- Verify Stripe webhook signatures before parsing side effects.
- Sign or server-store OAuth state and verify callback user membership.
- Rate-limit expensive, webhook, auth, invite, sync, and integration endpoints.
- Return generic errors to the client and sanitized details to server logs.

## AI Coding

- Do not paste production secrets, raw tokens, private customer exports, webhook payloads, or full datasets into AI tools.
- Require human review for AI-generated auth, RLS, service-role, webhook, OAuth, migration, storage, dependency, and env changes.
- Reject AI code that lacks deny-case tests for authorization-sensitive paths.
- Ask Codex to verify generated code against this checklist before merge.
