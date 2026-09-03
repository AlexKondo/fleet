/**
 * Thrown wherever a required Supabase env var is absent at runtime. A distinct class
 * (rather than a plain Error) so callers several layers up — e.g. a Server Action's
 * catch block — can tell "the deploy target is misconfigured" apart from a genuine
 * transient failure, and show a message that says so instead of "try again in a
 * moment" (which is actively misleading for a config problem retrying can't fix).
 */
export class MissingEnvVarError extends Error {
  constructor(missing: string[]) {
    super(
      `Missing required env var(s): ${missing.join(", ")}. Set them in the deploy ` +
        `platform's project settings (they are not committed to the repo).`,
    );
    this.name = "MissingEnvVarError";
  }
}

/**
 * Prefer this over a bare `err instanceof MissingEnvVarError` at call sites that decide
 * user-facing messaging. `admin.ts` imports the class via `"./env"` and callers like
 * `signup/actions.ts` via `"@/lib/supabase/env"` — the same resolved file today, but a
 * `name` fallback costs nothing and keeps that check working even if a future bundling
 * change (e.g. a route split introducing a dynamic import) ever produced two module
 * instances of this file, which would otherwise make `instanceof` silently fail and
 * mask the exact config error this class exists to surface.
 */
export function isMissingEnvVarError(err: unknown): err is MissingEnvVarError {
  return err instanceof MissingEnvVarError || (err instanceof Error && err.name === "MissingEnvVarError");
}

/**
 * Both Server Components and Middleware create their own Supabase client from these two
 * vars. On a fresh deploy target (e.g. a new Vercel project) they're easy to forget —
 * .env.local is gitignored on purpose and never travels with the repo — and an
 * undefined url/key makes @supabase/ssr throw synchronously, which for Middleware means
 * every route crashes with an opaque MIDDLEWARE_INVOCATION_FAILED. This throws a message
 * that names the exact missing variable instead, so it's actionable from the deploy
 * platform's function logs.
 */
export function getSupabasePublicEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    throw new MissingEnvVarError(missing);
  }

  return { url, anonKey } as { url: string; anonKey: string };
}
