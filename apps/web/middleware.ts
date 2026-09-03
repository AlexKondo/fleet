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
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
