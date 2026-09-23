/**
 * set-user-password.mjs — set (or reset) an email/password credential on a
 * Supabase auth user via the service-role Admin API.
 *
 * Accounts created through Google OAuth have no password, so email/password
 * sign-in fails for them until one is set. This attaches a password to the
 * existing user without disturbing the Google identity — both sign-in methods
 * then work for the same account.
 *
 * Prereqs:
 *   1. The Supabase project's Email auth provider is ENABLED
 *      (Dashboard → Authentication → Providers → Email). Setting a password
 *      here does nothing if password sign-in is turned off for the project.
 *   2. Credentials in the environment (never committed):
 *        NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
 *        SUPABASE_SERVICE_ROLE_KEY
 *   3. The new password supplied via the NEW_USER_PASSWORD env var
 *      (kept out of argv so it never lands in shell history or process lists).
 *
 * Usage (dry run — looks the user up and reports providers, writes nothing):
 *   node --env-file=.env.local scripts/set-user-password.mjs user@example.com
 *
 * Usage (apply — requires NEW_USER_PASSWORD and --commit):
 *   NEW_USER_PASSWORD='your-strong-password' \
 *     node --env-file=.env.local scripts/set-user-password.mjs user@example.com --commit
 *
 * Nothing secret (password or key) is ever printed.
 */
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const newPassword = process.env.NEW_USER_PASSWORD;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (!email) {
  fail('Provide the target email as the first argument, e.g. `... set-user-password.mjs you@example.com`.');
}
if (!url || !key) {
  fail('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (pass them via --env-file=.env.local or the environment).');
}
if (COMMIT) {
  if (!newPassword) {
    fail('--commit requires the NEW_USER_PASSWORD env var to be set (kept out of argv on purpose).');
  }
  if (newPassword.length < 8) {
    fail('NEW_USER_PASSWORD must be at least 8 characters.');
  }
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(targetEmail) {
  const perPage = 200;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const match = users.find((u) => (u.email ?? '').toLowerCase() === targetEmail);
    if (match) return match;
    if (users.length < perPage) return null; // last page reached
  }
  return null;
}

async function main() {
  console.log(`Looking up user: ${email}`);
  const user = await findUserByEmail(email);

  if (!user) {
    fail(`No auth user found with email ${email}. Check the address, or create the account first.`);
  }

  const providers = (user.identities ?? []).map((i) => i.provider);
  const hasEmailIdentity = providers.includes('email');
  console.log(`Found user id: ${user.id}`);
  console.log(`Existing sign-in providers: ${providers.length ? providers.join(', ') : '(none)'}`);
  console.log(`Email confirmed: ${user.email_confirmed_at ? 'yes' : 'no'}`);
  console.log(`Already has an email/password identity: ${hasEmailIdentity ? 'yes' : 'no'}`);

  if (!COMMIT) {
    console.log('\nDry run — no changes written.');
    console.log('Re-run with NEW_USER_PASSWORD set and --commit to set the password.');
    return;
  }

  const { data, error } = await admin.auth.admin.updateUserById(user.id, {
    password: newPassword,
    email_confirm: true,
  });
  if (error) throw error;

  const updatedProviders = (data?.user?.identities ?? []).map((i) => i.provider);
  console.log('\nPassword set successfully.');
  console.log(`Sign-in providers now: ${updatedProviders.length ? updatedProviders.join(', ') : '(unchanged)'}`);
  console.log(`\nYou can now sign in at /login with ${email} and the password you provided.`);
  console.log('If sign-in still fails, confirm the Email provider is enabled in Supabase → Authentication → Providers.');
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
