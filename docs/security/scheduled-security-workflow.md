# Scheduled Security Workflow

## Daily

Inspect:
- Secret scan results.
- Dependency advisory status.
- Failed GitHub checks.
- Failed Vercel deployments.
- Auth, webhook, sync, integration, and RLS-related errors.

Output:
- GitHub Actions summary named `Security Daily Status`.
- GitHub issue only if a Critical or High finding appears or a required check fails repeatedly.

## Weekly

Inspect:
- Files changed during the previous week.
- New or changed API routes.
- New or changed migrations and RLS policies.
- New dependencies or lockfile updates.
- New environment variables.
- New service-role usage.
- New sensitive logs.

Output:
- Weekly security review summary.
- GitHub issues for each Medium+ finding.
- Codex PR/repo review using `docs/security/codex-prompts.md`.

## Monthly

Inspect:
- Full codebase security posture.
- Supabase RLS and storage policies.
- Credential storage and browser exposure.
- Dependency risk and package health.
- Privacy data map.
- Vercel production and preview deployment configuration.
- Security regression test coverage.

Output:
- Monthly security audit report.
- Prioritized remediation backlog.
- Updated `docs/security/privacy-data-map.md` if data flows changed.

## Quarterly

Inspect:
- Threat model assumptions and attacker stories.
- GitHub, Vercel, Supabase, Stripe, Resend, Google, and Ahrefs access.
- Key rotation status.
- Backup and restore process.
- Incident response readiness.
- Whether Codex/Claude workflows are following the AI coding safety rules.

Output:
- Updated threat model or confirmation that it is still current.
- Access review record.
- Key rotation checklist.
- Incident tabletop notes.
- Security regression test gap list.
