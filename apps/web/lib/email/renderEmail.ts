/**
 * Minimal inline-styled HTML wrapper shared by every transactional email this app
 * sends. Email clients don't reliably load external/Tailwind CSS, so this stays plain
 * inline styles rather than reusing the app's own class names.
 */
export function renderEmail({
  heading,
  bodyLines,
  ctaLabel,
  ctaUrl,
}: {
  heading: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaUrl?: string;
}): { html: string; text: string } {
  const paragraphs = bodyLines
    .map((line) => `<p style="margin:0 0 12px;color:#1f2937;font-size:14px;line-height:1.5;">${line}</p>`)
    .join("\n");

  const cta =
    ctaLabel && ctaUrl
      ? `<p style="margin:24px 0 0;">
           <a href="${ctaUrl}" style="display:inline-block;background:#f5a623;color:#0b1220;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;padding:10px 20px;border-radius:4px;">
             ${ctaLabel}
           </a>
         </p>`
      : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#0b1220;padding:20px 24px;">
                <span style="color:#edf1f7;font-weight:800;font-size:18px;letter-spacing:-0.02em;text-transform:uppercase;">Fleet<span style="color:#f5a623;">.</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 16px;color:#0b1220;font-size:18px;">${heading}</h1>
                ${paragraphs}
                ${cta}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [heading, "", ...bodyLines.map(stripTags), ...(ctaLabel && ctaUrl ? ["", `${ctaLabel}: ${ctaUrl}`] : [])].join(
    "\n",
  );

  return { html, text };
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}
