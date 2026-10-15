import {
    credentialSecretState,
    openCredentialSecrets,
    sealCredentialSecrets,
    type KeyRing,
    type SecretState,
    GoogleTokenCryptoError,
} from './google-token-crypto';

/**
 * Idempotent sealer for existing `client_integrations.credentials` rows.
 * Dry-run classifies and writes nothing. Verify opens the stored row and
 * checks the token strings still match the pre-image. The report never
 * includes token material.
 */

export interface IntegrationSecretRow {
    id: string;
    organizationId: string;
    clientId: string;
    service: string;
    credentials: unknown;
}

export interface BackfillFailure {
    clientId: string;
    service: string;
    code: 'key_missing' | 'invalid' | 'conflict' | 'verify_failed' | 'decrypt_failed';
}

export interface BackfillReport {
    dryRun: boolean;
    verify: boolean;
    examined: number;
    unchanged: number;
    plaintext: number;
    rotate: number;
    updated: number;
    failed: number;
    failures: BackfillFailure[];
}

const FAILURE_LIMIT = 20;

export async function executeGoogleTokenBackfill(input: {
    rows: IntegrationSecretRow[];
    ring: KeyRing | null;
    dryRun: boolean;
    verify: boolean;
    write?: (row: IntegrationSecretRow, next: Record<string, unknown>) => Promise<'updated' | 'conflict'>;
    reread?: (row: IntegrationSecretRow) => Promise<unknown>;
}): Promise<BackfillReport> {
    const report: BackfillReport = {
        dryRun: input.dryRun,
        verify: input.verify,
        examined: 0,
        unchanged: 0,
        plaintext: 0,
        rotate: 0,
        updated: 0,
        failed: 0,
        failures: [],
    };

    for (const row of input.rows) {
        report.examined += 1;
        let state: SecretState;
        try {
            state = credentialSecretState(row.credentials, input.ring);
        } catch {
            fail(report, row, 'invalid');
            continue;
        }

        if (state === 'empty' || state === 'sealed') {
            if (input.verify && state === 'sealed') {
                if (!verifySealed(row.credentials, input.ring)) {
                    fail(report, row, 'verify_failed');
                    continue;
                }
            }
            report.unchanged += 1;
            continue;
        }

        if (state === 'plaintext') report.plaintext += 1;
        if (state === 'rotate') report.rotate += 1;
        if (state === 'locked' || state === 'invalid' || !input.ring) {
            fail(report, row, input.ring ? 'invalid' : 'key_missing');
            continue;
        }

        if (input.dryRun) continue;

        let before: Record<string, unknown>;
        let next: Record<string, unknown>;
        try {
            before = openCredentialSecrets(row.credentials, input.ring);
            next = sealCredentialSecrets(row.credentials, input.ring);
        } catch (error) {
            fail(report, row, error instanceof GoogleTokenCryptoError ? 'decrypt_failed' : 'invalid');
            continue;
        }

        const wrote = await input.write?.(row, next);
        if (wrote !== 'updated') {
            fail(report, row, 'conflict');
            continue;
        }

        if (input.verify) {
            const stored = await input.reread?.(row);
            if (!sameTokens(before, stored, input.ring) || credentialSecretState(stored, input.ring) === 'plaintext') {
                fail(report, row, 'verify_failed');
                continue;
            }
        }
        report.updated += 1;
    }

    return report;
}

function verifySealed(credentials: unknown, ring: KeyRing | null): boolean {
    if (!ring) return false;
    try {
        const opened = openCredentialSecrets(credentials, ring);
        return tokenFieldOk(opened.access_token) && tokenFieldOk(opened.refresh_token);
    } catch {
        return false;
    }
}

function sameTokens(before: Record<string, unknown>, stored: unknown, ring: KeyRing): boolean {
    try {
        const opened = openCredentialSecrets(stored, ring);
        return opened.access_token === before.access_token && opened.refresh_token === before.refresh_token;
    } catch {
        return false;
    }
}

function tokenFieldOk(value: unknown): boolean {
    return value == null || value === '' || typeof value === 'string';
}

function fail(report: BackfillReport, row: IntegrationSecretRow, code: BackfillFailure['code']) {
    report.failed += 1;
    if (report.failures.length < FAILURE_LIMIT) {
        report.failures.push({ clientId: row.clientId, service: row.service, code });
    }
}
