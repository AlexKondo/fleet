/**
 * Base URL for links inside outbound email (CTA buttons, password-reset redirect) and
 * any other absolute-URL need outside the browser (where `window.location` isn't
 * available). Prefers an explicit `NEXT_PUBLIC_APP_URL` (set once for the stable
 * production domain — Vercel's own `VERCEL_URL` reflects the *specific deployment*,
 * which changes on every deploy and would silently break a previously-sent password
 * reset link once a new deploy landed) and falls back to `VERCEL_URL` for preview
 * deployments that never set it, then localhost for local dev.
 */
export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  return "http://localhost:3000";
}
