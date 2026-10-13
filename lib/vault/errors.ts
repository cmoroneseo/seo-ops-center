const SAFE_MESSAGE = /^(Title |Body |Quote |Effective |Review |Contact |Rule |Applies-to |Source |Pinned |Vault |Only |Viewers |Portal |Forbidden|Unauthorized|Nothing |A quote |Dismiss )/;

export function vaultRpcStatus(error: { code?: string | null; message?: string | null }): 400 | 403 | 404 | 409 | 500 {
    const code = error.code ?? '';
    const message = error.message ?? '';
    if (code === '40001' || code === '23505' || /changed concurrently/i.test(message)) return 409;
    if (code === 'P0002' || /not found/i.test(message)) return 404;
    if (code === '42501' || /cannot access the vault|cannot propose|cannot change the vault|viewers cannot|only the proposer|forbidden|unauthorized/i.test(message)) return 403;
    if (code === '23514' || SAFE_MESSAGE.test(message)) return 400;
    if (!code && !message) return 500;
    return 500;
}

export function vaultRpcFailure(error: { code?: string | null; message?: string | null }): { status: 400 | 403 | 404 | 409 | 500; error: string } {
    const status = vaultRpcStatus(error);
    if (status === 409) return { status, error: 'This vault entry changed. Reload it and try again.' };
    if (status === 404) return { status, error: 'Not found' };
    if (status === 403) return { status, error: 'Forbidden' };
    if (status === 500) return { status, error: 'Vault request failed' };
    const message = (error.message ?? '').replace(/^ERROR:\s*/i, '').split('\n')[0].trim();
    return { status, error: SAFE_MESSAGE.test(message) ? message : 'Vault entry is invalid' };
}
