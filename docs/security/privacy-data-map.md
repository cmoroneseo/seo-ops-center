# Privacy And Data Protection Map

## Data Collected

- Users: email, full name, avatar URL, auth session metadata, organization membership, role.
- Organizations: name, slug, subscription status, Stripe customer ID.
- Clients: SEO client names, URLs, account manager, status, budgets, notes, logo URL, launch/renewal data.
- Work data: tasks, projects, reports, monthly plans, deliverables, time logs, change logs, team bonus data.
- Metrics: GA4, GSC, Google Business Profile, Ahrefs, manual metric entries, sync run status.
- Integration credentials: Google access/refresh tokens and Ahrefs API keys.
- Billing: Stripe customer and subscription identifiers.

## Storage Locations

- Supabase Postgres tables.
- Supabase Storage bucket `client-logos`.
- Vercel runtime logs and deployment metadata.
- GitHub repository, issues, Actions logs, and artifacts.
- Third-party providers: Stripe, Resend, Google APIs, Ahrefs.
- Local import/export scripts and local `.env.local`.

## Access Rules

- Organization members can access normal tenant data only for their organizations.
- Owners/admins can manage membership, integrations, and sensitive organization settings.
- Service-role access is reserved for server routes, webhooks, sync jobs, and one-off trusted scripts.
- Integration credentials must not be exposed to browser-readable queries or client components.
- Team bonus and compensation-like data requires owner/admin-only access.

## Review Questions

- Is this data required for the feature?
- Is the field tenant-scoped?
- Is the access path browser, server, service role, or third party?
- Is the value logged, returned to clients, sent to AI tools, or stored in GitHub issues?
- Can the value be redacted, truncated, tokenized, aggregated, or deleted sooner?
- Is consent, notice, or customer contract language needed before sharing with a third party?

## AI Tool Rules

- Never paste production secrets, cookies, OAuth tokens, API keys, private customer exports, webhook payloads, or full user datasets into Claude or Codex.
- Prefer code structure, schemas, synthetic examples, and redacted logs.
- If a real sample is needed, remove names, emails, tokens, IDs, client URLs, and billing identifiers first.
- Do not ask AI tools to infer customer-sensitive strategy from private client reports unless the data has been approved for that use.

## Minimization Defaults

- Store integration status and credential metadata separately from raw credentials where practical.
- Return only derived connection flags to the browser.
- Keep provider error details out of client responses.
- Redact provider tokens, request bodies, cookies, and emails in logs.
- Review retention for sync errors, import logs, generated reports, and Vercel/GitHub artifacts monthly.
