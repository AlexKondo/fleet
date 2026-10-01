import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Phase C6 - REAL-LLM classification battery (testing/chat-carpool/battery.live.test.ts). Never
 * part of the normal suite (vitest.config.ts does not include it): it calls the live Claude API
 * with API_CLAUDE from the repo-root .env. Run from apps/web:
 *   npx vitest run --config vitest.battery.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["../../testing/chat-carpool/*.live.test.ts"],
    testTimeout: 900_000,
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "./test/server-only-stub.ts"),
      "next/cache": path.resolve(__dirname, "./test/next-cache-stub.ts"),
      "@/lib": path.resolve(__dirname, "./lib"),
      "@supabase/supabase-js": path.resolve(__dirname, "./node_modules/@supabase/supabase-js"),
      "@/app": path.resolve(__dirname, "./app"),
      "@fleet/domain": path.resolve(__dirname, "../../packages/domain/src/index.ts"),
    },
  },
});
