import { it, expect } from "vitest";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { assistantPolicy } from "./aiPolicy";
const db = (data: unknown, error: unknown = null) =>
  ({ rpc: async () => ({ data, error }) }) as unknown as TypedSupabaseClient;
it("enforces a disabled assistant and fails closed on an unconfirmed policy", async () => {
  expect((await assistantPolicy(db({ enabled: false }))).enabled).toBe(false);
  expect((await assistantPolicy(db({ enabled: true }))).enabled).toBe(true);
  expect(
    (await assistantPolicy(db(null, { code: "NETWORK_ERROR" }))).enabled,
  ).toBe(false);
  expect((await assistantPolicy(db(null))).enabled).toBe(false);
});
it("keeps pre-0075 installations compatible only when the policy RPC is absent", async () => {
  expect(await assistantPolicy(db(null, { code: "PGRST202" }))).toEqual({
    enabled: true,
    available: true,
    legacy: true,
  });
});
