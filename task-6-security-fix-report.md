# Task 6 — Basecamp authorization remediation

## Outcome

The six scan findings and the related Basecamp sibling routes identified during remediation are fixed in code. Provider calls and service-role reads/writes now sit behind authenticated, canonical organization/client/task/time-log authorization. Browser-writable state no longer grants internal catalog access or changes Basecamp client/task/entry trust links after migration 031 is applied.

This change does not delete, rewrite, or auto-rebind existing client configuration. Existing Basecamp bindings remain usable under the controller-approved rules.

## Vulnerable paths closed

1. `organizations.is_internal` could be set through tenant RLS and then unlock the global Basecamp project catalog.
2. `clients.custom_fields.basecamp_*` values could be changed through tenant RLS and then act as a provider-project allowlist.
3. `GET /api/integrations/basecamp/todolists` trusted a browser-scoped project selection.
4. `GET /api/integrations/basecamp/todos` trusted browser scope and did not server-verify that the list belonged to the project.
5. `POST /api/integrations/basecamp/import-tasks` trusted caller organization/client/project/todo values before service-role inserts.
6. `GET|POST /api/clients/[id]/basecamp-config` used service-role access after authentication only.

Sibling inventory also closed:

- `GET /api/integrations/basecamp/imported-ids`
- `POST /api/integrations/basecamp/push`
- `GET|POST /api/integrations/basecamp/timesheet`
- `GET /api/integrations/basecamp/connect`
- `GET /api/integrations/basecamp/callback`

## Enforced invariants

- Every browser-triggered Basecamp project operation requires an authenticated user, an explicit organization, current membership in that organization, and server-derived project entitlement before provider access.
- Trusted internal organizations retain full catalog enumeration. Migration 031 makes `organizations.is_internal` service-role/database-operator controlled.
- External organizations can enumerate only project IDs already present in their organization’s protected client bindings.
- An external client integration manager may preserve or clear that client’s existing project binding, but cannot nominate a different project. An internal integration manager may select only a project present in the live provider catalog.
- Selected todolists are verified under the authorized project before todos are returned or created.
- Imports derive the canonical organization from the authorized client, reject asserted-organization mismatch, authorize every project, and fetch each todo through its authorized project before the service-role writer is constructed.
- Imported-ID reads derive and constrain both canonical client and organization before the service-role reader is constructed.
- Push operations resolve the canonical task/client/organization, require integration-management permission, ignore caller provider IDs and task content, authorize the configured project, and verify the provider todolist/todo relationship before mutation.
- Timesheet GET authorizes organization membership and project before provider discovery.
- Timesheet POST resolves the canonical time log/client/organization and requires integration-management permission. Client work derives provider scope from protected client/task state. No-client work additionally requires a protected internal organization plus an owner/admin/delegated integration manager, then authorizes the selected project through the shared catalog guard. Removal also re-authorizes the canonical project and accepts only the canonical protected entry link.
- OAuth connect requires application authentication. Callback state is HMAC-signed, random, ten-minute limited, safe-return constrained, stored in an HTTP-only SameSite cookie, bound to the initiating authenticated user, and consumed once. Missing, mismatched, replayed, expired, tampered, or wrong-user state is rejected before exchange. Token values are neither logged nor rendered.

## Database control and operator path

`migrations/031_protect_basecamp_authorization_state.sql` adds narrow `BEFORE` triggers. Normal browser roles cannot:

- set or change `organizations.is_internal`;
- add, remove, or change any `clients.custom_fields` key matching `basecamp_%`;
- add or change `tasks.basecamp_todo_id` / `tasks.basecamp_project_id`;
- add or change `time_logs.basecamp_entry_id`.

The guards permit Supabase `service_role` and explicit `postgres` / `supabase_admin` sessions. This is the documented, operator-auditable provisioning path. Trigger functions are `SECURITY DEFINER` with a fixed `pg_catalog, public` search path. The migration contains no data rewrite, delete, or truncate, and its definitions are mirrored in `schema.sql`.

## OAuth credential handling

The repository’s established runtime convention is operator-managed `BASECAMP_ACCESS_TOKEN`, `BASECAMP_REFRESH_TOKEN`, and `BASECAMP_ACCOUNT_ID` environment variables; there is no repository-native encrypted credential store. The callback therefore exchanges a valid one-time code, discards the returned credentials, and responds with a generic `503` operator-provisioning instruction. Operators must obtain/provision runtime credentials through a controlled administrative process outside this browser response. The application never displays the access or refresh token.

## Files changed

- Route adapters: `app/api/clients/[id]/basecamp-config/route.ts` and all affected routes under `app/api/integrations/basecamp/` (`callback`, `connect`, `import-tasks`, `imported-ids`, `push`, `timesheet`, `todolists`, `todos`).
- Authorization and request handlers: `lib/security/tenant-authz.ts`, `lib/basecamp/api.ts`, `lib/basecamp/project-access.ts`, `lib/basecamp/config-route.ts`, `lib/basecamp/import-tasks-route.ts`, `lib/basecamp/imported-ids-route.ts`, `lib/basecamp/oauth-route.ts`, `lib/basecamp/push-route.ts`, `lib/basecamp/resource-routes.ts`, `lib/basecamp/timesheet-post-route.ts`.
- Browser callers: `components/tasks/CreateTaskModal.tsx`, `components/workspace/BasecampImportModal.tsx`, `components/workspace/IntegrationsTab.tsx`.
- Database: `migrations/031_protect_basecamp_authorization_state.sql`, `schema.sql`.
- Regression tests: the matching `lib/basecamp/*.test.ts` files plus `lib/basecamp-timesheet-route.test.ts`.

## TDD and reproduction proof

The request handlers were introduced behind dependency seams so negative direct-call tests can throw if an admin store/access source/provider is reached too early. The initial RED runs failed because the handlers or required checks did not exist. The final focused tests prove:

- unauthenticated, nonmember, non-manager, foreign-client, mismatched-organization, and cross-project calls return `400/401/403/409` before protected dependencies;
- a todo list must be returned by the authorized project before its todos are exposed;
- imported todos must be returned by the authorized project before admin insert;
- external configuration cannot switch to another organization project, but can preserve or clear its own binding;
- push ignores attacker-supplied project/todo/content fields and verifies canonical provider provenance;
- client and trusted-internal timesheet paths derive/authorize their distinct canonical scopes, including deletion;
- OAuth rejects tampering, expiry, replay, missing state, wrong user, and unsafe return destinations before exchange, and successful exchange responses contain no token values;
- the migration contains all four guards, is mirrored in the schema snapshot, and contains no legacy-data rewrite.

## Verification

- `node --test lib/planner/*.test.ts` — 105 passed.
- `node --test lib/basecamp/*.test.ts lib/basecamp-timesheet-route.test.ts` — 71 passed after the final additions.
- `npm run typecheck` — passed.
- Targeted `npx eslint` over every changed TypeScript/TSX file — 0 errors; two pre-existing warnings remain in untouched lines of `CreateTaskModal.tsx`.
- `npm run security:static` — exited 0 in advisory mode. Its Basecamp admin-client notices are syntactic review prompts; the listed route adapters now delay admin/provider construction until the tested authorization handlers allow it. The migration `SECURITY DEFINER` notice was manually checked for fixed `search_path` and narrow trigger-only behavior.
- `git diff --check` — passed.
- Fresh route inventory covered all ten routes under `app/api/integrations/basecamp` plus client `basecamp-config`.

## Remaining operational uncertainty

- Migration 031 was not applied to a live Supabase instance in this workspace. It must be applied before the DB column protections are effective in deployed environments.
- Existing client Basecamp bindings are intentionally preserved. An operator must audit those legacy bindings for correctness because the migration cannot prove their historical provenance.
- No live two-tenant Supabase/Basecamp credentialed test was available; request-level dependency tests prove ordering and canonical scoping, but deployment configuration and provider behavior still require a post-deploy smoke test.
- `POST /api/integrations/basecamp/webhook` remains in the inventory. It is not browser-authorized because it is an inbound provider callback; it fails closed unless `BASECAMP_WEBHOOK_SECRET` exists and exactly matches the request secret before the admin client is created. No OAuth access/refresh tokens are logged there. Rotation and secure delivery of that webhook secret remain operational responsibilities.
