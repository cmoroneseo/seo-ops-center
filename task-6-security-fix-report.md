# Task 6 — Basecamp authorization remediation

## Outcome

The six original scan findings, the related Basecamp sibling routes, and the six
follow-up reviewer repros are closed in code and database contracts. Provider and
service-role operations now follow authenticated, canonical tenant authorization;
identity/bootstrap and replay-sensitive state have durable database controls.
Migrations 031 and 032 preserve existing bindings and do not rewrite tenant data.

## Vulnerable paths closed

- Browser-writable `organizations.is_internal` and client `basecamp_*` custom fields
  could grant provider catalog/project authority.
- Todolist/todo, config, import, imported-ID, push, and timesheet routes trusted
  caller scope or reached global provider/service-role access too early.
- Organization members could self-insert as owner for any organization.
- Invite creation was unauthenticated and callback membership trusted `?org=`.
- Timesheet flat account entry operations did not prove project/recording provenance.
- Push create accepted a caller-selected todolist.
- OAuth replay protection was local to one cookie/server instance.
- Imported title, description, and due date came from the caller instead of Basecamp.
- The webhook accepted a query-string secret using ordinary string comparison.

## Enforced invariants

- Internal status and every client/task/time-log Basecamp trust field are protected
  from browser writes by fixed-search-path triggers. Existing values are preserved.
- Owner bootstrap is an authenticated RPC that fixes the user to `auth.uid()`, fixes
  the role to `owner`, locks the organization, requires `created_by = auth.uid()`,
  and works only before any membership exists. The self-owner INSERT policy is gone.
- Only an authenticated organization owner/admin can invite. A random token is
  stored only as a SHA-256 hash, bound to canonical org/inviter/email/member role and
  expiry, and consumed atomically by a service-role-only RPC. Callback `org` input is
  ignored; wrong-email, expired, missing, or replayed invites fail closed.
- OAuth state is random, signed, user-bound, ten-minute limited, safe-return checked,
  cookie-bound, and atomically consumed from `basecamp_oauth_states` before exchange.
  Replays fail across independent serverless instances. Tokens are not rendered or
  logged; without an encrypted repository-native store, callback fails closed after
  exchange and directs operators to controlled provisioning.
- All browser-triggered project operations require current membership and server-
  derived project entitlement before provider access. Trusted internal members keep
  legitimate catalog enumeration; external organizations remain restricted to
  protected existing bindings.
- Timesheet update/delete first find the protected entry in the authorized project's
  timesheet collection and require its parent to match the already-protected recording
  tuple. Create uses only a todo or project-timesheet recording verified under that
  project. Legacy entry links without a protected recording are refused pending an
  operator provenance audit; provider lookup never auto-adopts their parent.
- Push create ignores caller provider IDs and uses only the protected configured
  todolist after confirming it exists under the authorized configured project.
- Import fetches the todo through the authorized project and writes provider title,
  description, and due date. Only priority/category remain intentional local input.
- Webhook authentication uses only `x-basecamp-webhook-secret`, hashes both values,
  and compares fixed-length digests with `timingSafeEqual` before admin access.
- Malformed/non-object `custom_fields` normalize to `{}` and grant no project access.

## Database and operator controls

- `migrations/031_protect_basecamp_authorization_state.sql` protects internal status
  and Basecamp client/task/entry fields.
- `migrations/032_close_identity_and_provider_provenance.sql` removes self-owner
  insertion, adds constrained owner bootstrap, durable email-bound invites, durable
  OAuth state, `basecamp_recording_id`, and the protected project/entry/recording
  tuple. Both migrations use service-role/operator exceptions, fixed search paths,
  and contain no legacy binding rewrite.
- `docs/basecamp-oauth-provisioning.md` documents the executable Vercel secret path
  and the deliberate credential-storage limitation. `.env.example` lists the OAuth
  state and webhook secrets.

## Main files

- Database: `migrations/031_protect_basecamp_authorization_state.sql`,
  `migrations/032_close_identity_and_provider_provenance.sql`, `schema.sql`.
- Identity/invites: `app/(auth)/setup-organization/page.tsx`, `app/api/invite/route.ts`,
  `app/auth/callback/route.ts`, and `lib/security/{organization-bootstrap,invite-route,auth-callback,tenant-authz}.ts`.
- Basecamp: affected routes under `app/api/integrations/basecamp/`, client
  `basecamp-config`, and the matching authorization/request helpers under
  `lib/basecamp/`.
- Operations: `.env.example`, `docs/basecamp-oauth-provisioning.md`.
- Regression tests: matching `lib/basecamp/*.test.ts`,
  `lib/basecamp-timesheet-route.test.ts`, and `lib/security/*.test.ts` additions.

## Reproduction proof and legitimate controls

Request-level dependency seams assert that unauthenticated, nonmember, non-manager,
cross-org, cross-client, cross-project, mismatched-entry, mismatched-recording, replay,
and caller-override cases return before provider/admin dependencies run. Positive
controls cover new-org owner bootstrap, authorized member onboarding, internal and
external project flows, configured-list push, canonical provider import, verified
client/internal timesheet operations, and first-use OAuth callback. Migration/schema
contract tests assert the removed policy, narrow RPCs, durable ledgers, tuple trigger,
and absence of time-log/client data rewrites.

Fresh route inventory covered all ten routes under
`app/api/integrations/basecamp`. The webhook is the only secret-gated provider
callback and now authenticates before constructing its admin client; no additional
Basecamp sibling route remains outside the shared boundaries.

## Verification

- Focused correction regressions: 46 passed.
- `node --test lib/basecamp/*.test.ts lib/basecamp-timesheet-route.test.ts`: 79 passed.
- `node --test lib/planner/*.test.ts`: 105 passed.
- `npm run typecheck`: passed.
- Targeted ESLint: 0 errors; 4 pre-existing warnings in Settings plus the expected
  ignored `.env.example` notice.
- `npm run security:static`: exited 0 in advisory mode. Basecamp admin-client notices
  are syntactic prompts covered by the authorization-order tests; migration 032
  functions were manually checked for fixed search paths and minimal grants.
- `git diff --check`: passed.

## Residual operational requirements

- Apply migrations 031 and 032 before deployment; no live Supabase instance was
  available here for execution, so database behavior is covered by migration/schema
  contract tests rather than a deployed RLS test.
- Audit preserved legacy Basecamp client and time-log bindings. The application now
  refuses unverifiable entry links, but intentionally does not rewrite history.
- Provision OAuth credentials through the documented secret-manager path and perform
  a post-deploy two-tenant/Basecamp smoke test. The app deliberately has no browser
  credential hand-off until an encrypted credential store is introduced.
- Rotate and deliver the webhook header secret through the provider/operator channel.
