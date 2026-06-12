# Codex-Powered DevSecOps Workflow

This workflow turns Codex, GitHub, Vercel, and Supabase into a repeatable security operating system for SEO Ops Center.

## Security Goals

- Protect tenant data: clients, reports, metrics, notes, time logs, team bonus data, subscriptions, user profiles, OAuth tokens, and Ahrefs keys.
- Enforce access control at every layer: Supabase RLS, API routes, middleware, storage policies, server-only helpers, and client/server boundaries.
- Prevent secret exposure: Supabase service role, Stripe, Google OAuth, Resend, cron, webhook, Vercel, and third-party API secrets.
- Keep dependencies safe through automated advisory checks, dependency review, lockfile review, and monthly package risk reviews.
- Make deployments fail closed: no production mock-mode auth bypass, no placeholder env vars, no unsafe preview access to real data.
- Treat AI-generated code as untrusted until reviewed, tested, and approved by a human for sensitive areas.

## Threat Model

Primary assets:
- Supabase auth sessions and tenant membership rows.
- Client records, reports, metrics, notes, time logs, team bonus data, subscription data, and storage files.
- OAuth refresh tokens, Ahrefs API keys, Stripe secrets, webhook secrets, Resend keys, cron secrets, Vercel env vars, and GitHub secrets.

Trust boundaries:
- Browser to Next.js pages and route handlers.
- Next.js route handlers to Supabase anon client.
- Server-only code to Supabase service-role client.
- Supabase RLS between organizations.
- Vercel preview versus production deployments.
- OAuth, Stripe, Resend, Google, Ahrefs, GitHub Actions, Claude, and Codex.

High-risk attacker stories:
- A logged-in user for one organization forges `orgId` or `clientId` and reads or writes another tenant's data.
- A browser route accidentally returns `client_integrations.credentials`, exposing OAuth refresh tokens or API keys.
- A server route uses the service role before proving the user can access the target organization.
- An OAuth callback accepts unsigned state and links credentials to the wrong client or organization.
- A preview deployment points at production Supabase data and exposes unaudited changes.
- Logs capture user emails, tokens, provider payloads, cookies, webhook bodies, or integration errors with sensitive metadata.

Repository-specific hotspots:
- `lib/supabase/admin.ts`: service-role creation must stay server-only and should only be used after explicit authorization.
- `app/api/**`: route handlers must authenticate, authorize tenant access, validate input, and minimize responses.
- `migrations/**` and `schema.sql`: RLS, grants, storage policies, and `SECURITY DEFINER` functions must be reviewed.
- `lib/supabase/integrations.ts`: integration credentials must not be selected by browser-facing code.
- `middleware.ts`: mock mode must be development-only and must fail closed in production.

## Development Workflow

Before coding:
- Ask Codex for a threat-aware implementation plan when work touches auth, authorization, RLS, API routes, integrations, env vars, migrations, storage, logging, or dependencies.
- Define the actor, asset, trust boundary, and expected deny cases before implementation.

During coding:
- Derive identity from Supabase session server-side.
- Derive `organization_id`, role, and membership from trusted database checks, not request body fields.
- Use the service role only after tenant authorization has passed.
- Add negative tests for unauthorized, cross-tenant, malformed, expired, and missing-secret cases.
- Keep logs structured and redacted.

Before PR:
- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run build`.
- Run `npm run security:all`.
- Ask Codex for a PR security review using `docs/security/codex-prompts.md`.

PR review:
- Require human review for changes to `app/api/**`, `app/auth/**`, `middleware.ts`, `lib/supabase/**`, `migrations/**`, `schema.sql`, `.env.example`, `.github/**`, `package*.json`, and `vercel.json`.
- Require a security note in the PR description for any service-role, RLS, auth, webhook, OAuth, dependency, storage, or logging change.
- Convert Medium+ Codex findings into GitHub issues unless fixed in the PR.

Deployment:
- Run `npm run security:env:production` in the Vercel production environment.
- Confirm production env vars are set and not placeholders.
- Confirm preview deployments use preview data or protected access.
- Confirm cron, webhook, and OAuth callback URLs match the deployment environment.

Maintenance:
- Daily: secret scan, dependency advisory check, failed CI/deploy check, and auth/webhook/sync error review.
- Weekly: Codex review of changed security surfaces and dependency updates.
- Monthly: full Codex security audit, RLS review, dependency risk review, and privacy review.
- Quarterly: threat model refresh, access review, key rotation plan, backup/restore check, and incident tabletop.

## Local Security Commands

```bash
npm run security:env
npm run security:env:production
npm run security:static
npm run security:static:strict
npm run security:all
```

`security:static` is advisory by default so the repo can adopt the workflow before every existing finding is fixed. `security:static:strict` fails on Medium+ findings and should be used once the current security backlog is burned down.

## Finding Format

Every security finding should include:
- Severity: Critical, High, Medium, or Low.
- Asset impacted.
- Affected file and line.
- Exploit or abuse story.
- Impact.
- Recommended fix.
- Required test.
- Owner and due date.
