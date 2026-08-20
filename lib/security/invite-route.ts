type InviteAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        organizationName: string;
        role: 'owner' | 'admin';
    }
    | { ok: false; status: number; error: string };

interface Dependencies {
    authorizeInviter(organizationId: unknown): Promise<InviteAuthorization>;
    randomToken(): string;
    hashToken(token: string): string;
    createInvite(input: {
        tokenHash: string;
        organizationId: string;
        email: string;
        role: 'member';
        invitedBy: string;
        expiresAt: string;
    }): Promise<void>;
    revokeInvite(tokenHash: string): Promise<void>;
    generateAuthLink(email: string, redirectTo: string): Promise<string | null>;
    sendInviteEmail(input: {
        to: string;
        inviteUrl: string;
        organizationName: string;
        invitedByName: string;
    }): Promise<void>;
    siteUrl: string;
    now(): Date;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function normalizeEmail(value: unknown) {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function createInvitePost(dependencies: Dependencies) {
    return async function postInvite(req: Request): Promise<Response> {
        let tokenHash: string | null = null;
        try {
            const body = await req.json() as Record<string, unknown>;
            const email = normalizeEmail(body.email);
            if (!email || typeof body.organizationId !== 'string' || !body.organizationId.trim()) {
                return json({ error: 'Valid email and organizationId are required' }, 400);
            }

            const authorization = await dependencies.authorizeInviter(body.organizationId);
            if (!authorization.ok) {
                return json({ error: authorization.error }, authorization.status);
            }

            const rawToken = dependencies.randomToken();
            tokenHash = dependencies.hashToken(rawToken);
            const expiresAt = new Date(
                dependencies.now().getTime() + 7 * 24 * 60 * 60 * 1000,
            ).toISOString();
            await dependencies.createInvite({
                tokenHash,
                organizationId: authorization.organizationId,
                email,
                role: 'member',
                invitedBy: authorization.userId,
                expiresAt,
            });

            const callback = new URL('/auth/callback', dependencies.siteUrl);
            callback.searchParams.set('invite', rawToken);
            const inviteUrl = await dependencies.generateAuthLink(email, callback.toString());
            if (!inviteUrl) throw new Error('Failed to generate invite link');

            await dependencies.sendInviteEmail({
                to: email,
                inviteUrl,
                organizationName: authorization.organizationName,
                invitedByName: authorization.actorName,
            });
            return json({ success: true });
        } catch {
            if (tokenHash) await dependencies.revokeInvite(tokenHash).catch(() => {});
            return json({ error: 'Failed to send invitation' }, 500);
        }
    };
}
