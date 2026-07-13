// Shared branded-card shell for every email this app sends — factored out of login.ts once a
// second email type (billing/service-announcement) needed the same shell. Inline styles and a
// table layout throughout — email clients (Outlook/Gmail in particular) strip <style> blocks
// and ignore flexbox/grid, so this is the only markup that renders consistently across them.
// Colors are hardcoded hex rather than pulled from index.css's CSS variables since those
// aren't available in an email context.

export const FROM_ADDRESS = "noreply@drumandbytes.ee";
// Matches checkout.ts's own duplicate of this constant — see that file's comment on why it's
// hardcoded rather than derived from the request.
export const FRONTEND_URL = "https://roadconditions.drumandbytes.ee";

export interface EmailButton {
  label: string;
  href: string;
}

export function buildEmailHtml(params: {
  introHtml: string;
  button?: EmailButton;
  footerHtml: string;
}): string {
  const { introHtml, button, footerHtml } = params;
  return `<!doctype html>
<html lang="et">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0; padding:0; background:#f0f0f3; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f3; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:#ffffff; border-radius:16px; overflow:hidden;">
            <tr>
              <td style="padding:36px 32px 8px 32px; text-align:center;">
                <div style="width:48px; height:48px; margin:0 auto 16px auto; background:#2e9bff; border-radius:12px; color:#ffffff; font-size:24px; font-weight:700; line-height:48px;">T</div>
                <h1 style="margin:0; font-size:20px; font-weight:700; color:#1a1a1a;">Teeolud</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px; text-align:center; color:#1a1a1a; font-size:16px; line-height:1.5;">
                ${introHtml}
              </td>
            </tr>
            ${
              button
                ? `<tr>
              <td style="padding:8px 32px 0 32px; text-align:center;">
                <a href="${button.href}" style="display:inline-block; background:#2e9bff; color:#ffffff; font-size:16px; font-weight:600; text-decoration:none; padding:14px 32px; border-radius:10px;">${button.label}</a>
              </td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding:20px 32px 32px 32px; border-top:1px solid #f0f0f3; text-align:center; color:#6e6e73; font-size:13px; line-height:1.5;">
                ${footerHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
