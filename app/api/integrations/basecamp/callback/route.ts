import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/integrations/basecamp/callback
 * Handles the OAuth callback from Basecamp.
 * Exchanges the authorization code for an access token and displays
 * the values you need to copy into your environment variables.
 */
export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get('code');
    const error = req.nextUrl.searchParams.get('error');

    if (error) {
        return new NextResponse(errorPage(error), { headers: { 'Content-Type': 'text/html' } });
    }

    if (!code) {
        return new NextResponse(errorPage('No authorization code received from Basecamp.'), {
            headers: { 'Content-Type': 'text/html' },
        });
    }

    const clientId = process.env.BASECAMP_CLIENT_ID;
    const clientSecret = process.env.BASECAMP_CLIENT_SECRET;
    const redirectUri = process.env.BASECAMP_REDIRECT_URI ?? 'http://localhost:3000/api/integrations/basecamp/callback';

    if (!clientId || !clientSecret) {
        return new NextResponse(
            errorPage('BASECAMP_CLIENT_ID or BASECAMP_CLIENT_SECRET is not set.'),
            { headers: { 'Content-Type': 'text/html' } },
        );
    }

    // Exchange code for access token
    const tokenRes = await fetch('https://launchpad.37signals.com/authorization/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            type: 'web_server',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
        }),
    });

    if (!tokenRes.ok) {
        const body = await tokenRes.text();
        return new NextResponse(errorPage(`Token exchange failed: ${body}`), {
            headers: { 'Content-Type': 'text/html' },
        });
    }

    const tokenData = await tokenRes.json();
    const accessToken: string = tokenData.access_token;
    const refreshToken: string = tokenData.refresh_token;

    // Fetch the user's Basecamp accounts to get the Account ID
    const authRes = await fetch('https://launchpad.37signals.com/authorization.json', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'SEO Ops Center (seo@marketingempiregroup.com)',
        },
    });

    const authData = authRes.ok ? await authRes.json() : null;
    const accounts: Array<{ id: number; name: string; product: string; href: string }> =
        authData?.accounts ?? [];
    const basecampAccounts = accounts.filter((a) => a.product === 'bc3');

    return new NextResponse(successPage(accessToken, refreshToken, basecampAccounts), {
        headers: { 'Content-Type': 'text/html' },
    });
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function errorPage(message: string): string {
    return `<!DOCTYPE html>
<html>
<head><title>Basecamp OAuth Error</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:60px auto;padding:0 20px;background:#0f172a;color:#f8fafc}
.box{background:#1e293b;border:1px solid #ef4444;border-radius:12px;padding:24px}
h1{color:#ef4444;margin:0 0 12px}p{color:#94a3b8}</style></head>
<body><div class="box"><h1>OAuth Error</h1><p>${message}</p></div></body>
</html>`;
}

function successPage(
    accessToken: string,
    refreshToken: string,
    accounts: Array<{ id: number; name: string }>,
): string {
    const accountRows = accounts
        .map(
            (a) => `
      <div class="account">
        <strong>${a.name}</strong>
        <div class="value">${a.id}</div>
      </div>`,
        )
        .join('');

    return `<!DOCTYPE html>
<html>
<head><title>Basecamp Connected!</title>
<style>
body{font-family:system-ui,sans-serif;max-width:700px;margin:60px auto;padding:0 20px;background:#0f172a;color:#f8fafc}
h1{color:#10b981;margin:0 0 4px}
.subtitle{color:#64748b;margin:0 0 32px;font-size:14px}
.section{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:20px}
h2{margin:0 0 16px;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
label{display:block;font-size:12px;font-weight:600;color:#94a3b8;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
.value{font-family:monospace;font-size:13px;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px 16px;word-break:break-all;color:#e2e8f0;margin-bottom:16px}
.account{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px 16px;margin-bottom:8px}
.account strong{display:block;margin-bottom:4px;color:#e2e8f0}
.account .value{margin:0;padding:8px 12px;font-size:13px}
.note{background:#1e3a5f;border:1px solid #1d4ed8;border-radius:8px;padding:12px 16px;font-size:13px;color:#93c5fd;margin-top:8px}
.step{display:flex;gap:10px;margin-bottom:8px;font-size:13px;color:#94a3b8}
.step span{background:#1d4ed8;color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}
</style>
</head>
<body>
<h1>✅ Basecamp Connected!</h1>
<p class="subtitle">Copy the values below into your .env.local file and Vercel environment variables.</p>

<div class="section">
  <h2>Access Token</h2>
  <label>BASECAMP_ACCESS_TOKEN</label>
  <div class="value">${accessToken}</div>
  <label>BASECAMP_REFRESH_TOKEN</label>
  <div class="value">${refreshToken}</div>
</div>

<div class="section">
  <h2>Account ID — pick the one you use for client work</h2>
  ${accountRows || '<p style="color:#64748b;font-size:14px">No Basecamp 3 accounts found.</p>'}
  <label style="margin-top:16px">BASECAMP_ACCOUNT_ID</label>
  <div class="value">(copy the ID of your main account above)</div>
</div>

<div class="section">
  <h2>Add to .env.local</h2>
  <div class="note">Open your .env.local file and add:<br><br>
<code>BASECAMP_CLIENT_ID=your_client_id<br>
BASECAMP_CLIENT_SECRET=your_client_secret<br>
BASECAMP_ACCESS_TOKEN=${accessToken}<br>
BASECAMP_REFRESH_TOKEN=${refreshToken}<br>
BASECAMP_ACCOUNT_ID=paste_account_id_here</code>
  </div>
  <div class="note" style="margin-top:12px;background:#1a2e1a;border-color:#166534;color:#86efac">
    <strong>Then add the same 5 variables to Vercel</strong> under Project → Settings → Environment Variables.
  </div>
</div>

<div class="section">
  <h2>Next Steps</h2>
  <div class="step"><span>1</span> Copy the values above into .env.local</div>
  <div class="step"><span>2</span> Restart your dev server (<code>npm run dev</code>)</div>
  <div class="step"><span>3</span> Go to a client's Integrations tab and configure which Basecamp project to sync</div>
  <div class="step"><span>4</span> Add the same vars to Vercel for production</div>
</div>
</body>
</html>`;
}
