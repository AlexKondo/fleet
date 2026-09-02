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
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(", ")}. Set them in the deploy ` +
        `platform's project settings (they are not committed to the repo).`,
    );
  }

  return { url, anonKey } as { url: string; anonKey: string };
}
