# Reusable Codex Security Prompts

Use these prompts in Codex threads, PR reviews, scheduled reviews, and issue triage.

## Full Codebase Security Audit

```text
Run a repository-wide security audit. Focus on auth, authorization, Supabase RLS, service-role usage, API routes, webhooks, secrets, logging, tenant isolation, storage policies, dependency risk, and privacy exposure. Return findings by severity with file references, exploit scenario, impact, concrete fix, and required regression test.
```

## Pull Request Security Review

```text
Review this pull request as an application security reviewer. Identify only security, privacy, reliability, and deployment risks introduced by the diff. Pay special attention to service-role usage, user-controlled orgId/clientId, RLS bypasses, new env vars, logs, dependencies, migrations, and API route changes. Return findings first, ordered by severity, with exact file references.
```

## Supabase RLS Review

```text
Review Supabase RLS policies and migrations. Confirm every tenant-scoped table enforces organization membership, admin-only data is protected, service-role writes are justified, storage policies are path/tenant constrained, SECURITY DEFINER functions are minimal and use safe search_path behavior, and no policy allows privilege escalation or cross-tenant reads.
```

## API Endpoint Review

```text
Review this API endpoint. Verify authentication, authorization, input validation, tenant isolation, rate limiting, error handling, logging, service-role usage, response data minimization, CSRF or webhook protections, and abuse cases. Specifically check whether orgId, clientId, userId, role, or connectedBy is trusted from the browser.
```

## Secrets And Environment Review

```text
Review environment variable usage. Identify public/private mistakes, missing required vars, placeholder fallbacks, leaked secrets, production mock-mode risks, and any secret reachable from client code. Compare process.env usage against .env.example and recommend fail-closed behavior for production.
```

## Privacy And Data Exposure Review

```text
Review privacy and data exposure. Map collected user/client data, where it is stored, who can access it, what is logged, what is sent to third parties or AI tools, and where minimization, redaction, retention, or consent boundaries are needed.
```

## Dependency And Package Risk Review

```text
Review dependency and package risk. Inspect package changes for known vulnerabilities, suspicious packages, abandoned maintainers, risky postinstall scripts, broad permissions, transitive risks, and safer alternatives. Call out whether the package is used client-side or server-side.
```

## Vercel Deployment Readiness Review

```text
Review Vercel deployment readiness. Check production env requirements, preview deployment safety, cron and webhook secrets, auth behavior, logging level, build config, protected branches, OAuth redirect URLs, Supabase project targeting, and rollback concerns.
```

## AI-Generated Code Safety Review

```text
Review AI-generated code safety. Look for fabricated APIs, insecure defaults, missing authorization, overbroad RLS, unsafe migrations, secret exposure, logging of sensitive data, dependency hallucinations, and tests that only verify happy paths.
```

## Security Fix Verification

```text
Verify this security fix. Confirm the original exploit path is blocked, no new bypass was introduced, regression tests cover the deny case, logs are redacted, errors are safe, and behavior still works for authorized users.
```
