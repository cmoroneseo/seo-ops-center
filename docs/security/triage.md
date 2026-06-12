# Vulnerability Triage

Use this severity model for Codex findings, GitHub issues, and release decisions.

## Critical

Meaning:
- Cross-tenant data exposure.
- Production auth bypass.
- Supabase service-role key exposure.
- Raw OAuth token, refresh token, API key, cookie, or webhook secret leak.
- RLS disabled or bypassed for production tenant data.

Fix target:
- Immediately. Stop deployment or roll back if already deployed.

Review:
- Product owner or technical owner plus senior security/app reviewer.

## High

Meaning:
- Privilege escalation.
- Unauthorized tenant write/delete.
- Webhook forgery or unsigned OAuth state with realistic account-linking impact.
- Production mock-mode or placeholder-secret risk.
- Credential table exposed to authenticated users.

Fix target:
- Within 24-72 hours.

Review:
- Senior engineer plus Codex fix verification.

## Medium

Meaning:
- Missing rate limiting on abuse-prone endpoint.
- Sensitive logging without confirmed secret exposure.
- Weak validation with constrained impact.
- Overbroad storage policy.
- Dependency vulnerability with limited exploitability.
- Missing deny-case tests for sensitive code.

Fix target:
- Within 1-2 weeks.

Review:
- Normal PR review plus Codex security verification.

## Low

Meaning:
- Hardening gap.
- Minor information disclosure.
- Documentation, checklist, monitoring, or test coverage improvement.
- Outdated non-critical dependency.

Fix target:
- Normal backlog or maintenance batch.

Review:
- Normal PR review.

## Issue Template Fields

Every vulnerability issue should include:
- Severity.
- Asset impacted.
- Affected path and line.
- Exploit or abuse story.
- Impact.
- Recommended fix.
- Required regression test.
- Owner.
- Due date.
- Verification notes.
