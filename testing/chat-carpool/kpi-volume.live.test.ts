/**
 * F1 - LIVE volume check of the KPI data function: 1500 search-log rows (above PostgREST's 1000-row max_rows cap) +
 * 1200 events/requests-free org, seeded through the service role in a disposable org; the dashboard data function must
 * count all 1500. Cleaned up in afterAll.
 * Run from apps/web: npx vitest run --config vitest.battery.config.ts kpi-volume
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const text = fs.readFileSync("C:/projects/fleet/.env", "utf8");
  const get = (n: string) => text.match(new RegExp("^" + n + "=(.*)$", "m"))?.[1]?.trim() ?? "";
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("NEXT_PUBLIC_SUPABASE_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
});

import { createClient } from "@supabase/supabase-js";
import { loadCarpoolKpis } from "@/lib/carpool/kpi/loadKpis";
// @ts-expect-error plain ESM helpers shared with the live scripts
import { sql, provisionOrg, cleanupOrgs, URL_, SVC } from "../../supabase/tests/lib/live.mjs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let org: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
const N = 1500;

beforeAll(async () => {
  admin = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } });
  org = await provisionOrg("kv", [["u1", "employee"]], 1);
  const now = new Date().toISOString();
  for (let i = 0; i < N; i += 500) {
    const rows = Array.from({ length: 500 }, (_, k) => ({
      organization_id: org.orgId, user_id: org.users.u1.id, source: (i + k) % 3 === 0 ? "chat" : "web", offers_evaluated: 2, prefilter_candidates: 1,
      precise_route_calls: 1, compatible_count: 1, outcome: "matches", latency_ms: 100, created_at: now,
    }));
    const { error } = await admin.from("carpool_search_log").insert(rows);
    if (error) throw new Error(JSON.stringify(error));
  }
}, 300_000);

afterAll(async () => { await cleanupOrgs([org], "KPI-volume"); }, 300_000);

describe("KPI dashboard at volume (live)", () => {
  it("a plain select is capped at 1000 by PostgREST (why the loader paginates)", async () => {
    const { data } = await admin.from("carpool_search_log").select("id").eq("organization_id", org.orgId).limit(20000);
    expect((data ?? []).length).toBeLessThanOrEqual(1000);
  });
  it("loadCarpoolKpis counts all 1500 rows and the derived sums are exact", async () => {
    const r = await loadCarpoolKpis(admin, org.orgId, 7);
    expect(r.search.searches).toBe(N);
    expect(r.search.offersEvaluated).toBe(N * 2);
    expect(r.search.compatibleMatches).toBe(N);
    expect(r.search.bySource).toEqual({ web: 1000, chat: 500 });
  }, 120_000);
  it("an unreachable table surfaces as an error, not zeros", async () => {
    const broken = createClient(URL_, "invalid-key", { auth: { persistSession: false } });
    await expect(loadCarpoolKpis(broken as never, org.orgId, 7)).rejects.toThrow(/kpi query failed/);
  }, 60_000);
});
void sql;
