import { NextResponse, type NextRequest } from "next/server";
import { updateSupabaseSession } from "./lib/supabase/middleware";
import { isMissingEnvVarError } from "./lib/supabase/env";

export async function middleware(request: NextRequest) {
  try {
    return await updateSupabaseSession(request);
  } catch (err) {
    // getSupabasePublicEnv() throws MissingEnvVarError synchronously when its env vars
    // are absent — uncaught here, that means every single route (not just the one the
    // user happened to load) crashes with an opaque MIDDLEWARE_INVOCATION_FAILED, before
    // the request ever reaches a page that could show an actual message. Session
    // refresh/redirect just doesn't happen this request; the page render downstream hits
    // the same missing env var and is caught by the root error boundary (app/error.tsx)
    // instead, which is a page a person can actually read.
    if (isMissingEnvVarError(err)) {
      console.error("middleware: env misconfigured, passing request through unauthenticated", err);
      return NextResponse.next({ request });
    }
    throw err;
  }
}

export const config = {
  // Every request that reaches this middleware pays for a Supabase auth round trip
  // (updateSupabaseSession), so anything that can never need a session is excluded here
  // rather than filtered inside the handler — a matched-but-skipped request still costs a
  // middleware invocation. Covers the Next build output, the PWA icon/manifest set in
  // public/, and the usual static extensions (fonts and .map included: a browser fetches
  // those alongside the page, and each one used to trigger its own auth check).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|webmanifest|woff|woff2|ttf|otf)$).*)",
  ],
};
