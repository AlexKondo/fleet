import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Phase C2 — apps/web had NO test runner configured at all before this phase (verified: no
 * `.test.ts` files existed anywhere under apps/web, no vitest/jest devDependency, no `test`
 * script). Rather than silently skip the required provider/Cost Guard unit tests, this adds
 * the minimal sane setup: vitest (already used by packages/domain, so no new tooling
 * concept for this repo) restricted to `lib/geospatial/**` for this phase — it does not
 * attempt to bring the rest of the Next.js app under test, which is out of this phase's
 * scope.
 *
 * Phase C3 extends `include` to also cover `app/carpool/**` — the new matching-engine
 * orchestration layer (`apps/web/app/carpool/actions.ts`) needs the same unit-test
 * capability (mocked RoutingProvider, no live Google calls, no real Supabase client),
 * still deliberately scoped rather than bringing the whole `app/` tree under test.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/geospatial/**/*.test.ts",
      "app/carpool/**/*.test.ts",
      "lib/carpool/**/*.test.ts",
      "app/chat/**/*.test.ts",
      "app/trips/**/*.test.ts",
      "app/settings/**/*.test.ts",
      "app/*.test.ts",
      "lib/trips/**/*.test.ts",
      "lib/auth/**/*.test.ts",
      "lib/supabase/**/*.test.ts",
      "app/account/**/*.test.ts",
      "app/analytics/**/*.test.ts",
      "app/gate/**/*.test.ts",
      "app/reservations/**/*.test.ts",
      "app/api/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      // "server-only" unconditionally throws when required outside Next's own build
      // (it exists purely to fail a *webpack client-bundle* build, not to run under a
      // plain Node test runner) — stub it out for tests only, same as this repo would do
      // for any Next-specific compile-time guard.
      "server-only": path.resolve(__dirname, "./test/server-only-stub.ts"),
      "@/lib": path.resolve(__dirname, "./lib"),
      "@/app": path.resolve(__dirname, "./app"),
      "@fleet/domain": path.resolve(__dirname, "../../packages/domain/src/index.ts"),
      "@fleet/supabase-client": path.resolve(__dirname, "../../packages/supabase-client/src/index.ts"),
    },
  },
});
