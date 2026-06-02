interface TeamInviteProps {
    inviteUrl: string;
    organizationName: string;
    invitedByName?: string;
}

export function teamInviteEmail({ inviteUrl, organizationName, invitedByName }: TeamInviteProps): string {
    const invitedBy = invitedByName ? `<strong>${invitedByName}</strong> has invited you` : `You've been invited`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>You're invited to ${organizationName}</title>
</head>
<body style="margin:0;padding:0;background-color:#0d0d0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0d0d0d;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / Brand -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="display:inline-block;background:linear-gradient(135deg,#ff0080,#ff5f6d);border-radius:12px;padding:10px 20px;">
                <span style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.5px;">SEO Ops Command Center</span>
              </div>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#1a1a1a;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:40px;">

              <!-- Heading -->
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">
                You're invited to join<br/>
                <span style="background:linear-gradient(135deg,#ff0080,#ff5f6d);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${organizationName}</span>
              </h1>

              <p style="margin:0 0 28px;font-size:15px;color:#999999;line-height:1.6;">
                ${invitedBy} to collaborate on <strong style="color:#ffffff;">${organizationName}</strong>'s SEO operations — track client hours, manage deliverables, and monitor campaign performance all in one place.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#ff0080,#ff5f6d);border-radius:10px;">
                    <a href="${inviteUrl}"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
                      Accept Invitation →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- What you get -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#111111;border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:20px;margin-bottom:28px;">
                <tr><td>
                  <p style="margin:0 0 12px;font-size:12px;font-weight:600;color:#666666;text-transform:uppercase;letter-spacing:1px;">What you'll have access to</p>
                  <table cellpadding="0" cellspacing="0">
                    <tr><td style="padding:4px 0;font-size:14px;color:#cccccc;">📊 &nbsp;Client workspace &amp; monthly planners</td></tr>
                    <tr><td style="padding:4px 0;font-size:14px;color:#cccccc;">⏱️ &nbsp;Time logging &amp; hour tracking</td></tr>
                    <tr><td style="padding:4px 0;font-size:14px;color:#cccccc;">📋 &nbsp;Deliverables tracker</td></tr>
                    <tr><td style="padding:4px 0;font-size:14px;color:#cccccc;">📝 &nbsp;Client notes &amp; activity feed</td></tr>
                  </table>
                </td></tr>
              </table>

              <!-- Expiry note -->
              <p style="margin:0 0 4px;font-size:13px;color:#555555;">
                This invitation link expires in <strong style="color:#888888;">24 hours</strong>. If you didn't expect this email, you can safely ignore it.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#444444;">
                SEO Ops Command Center &nbsp;·&nbsp; Marketing Empire Group<br/>
                <a href="https://seo-ops-center.vercel.app" style="color:#666666;">seo-ops-center.vercel.app</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
