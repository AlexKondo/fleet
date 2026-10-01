import { describe, expect, it } from "vitest";
import { chunked, loadCarpoolKpis, pageAll, PAGE_SIZE } from "./loadKpis";

// Fake admin client that, like PostgREST on this project, never returns more than 1000 rows per request.
function fakeAdmin(tables: Record<string, Record<string, unknown>[]>, failTable?: string) {
  const calls: { table: string; from: number; to: number }[] = [];
  const from = (table: string) => {
    let range: [number, number] = [0, 999];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "order", "in"]) q[m] = () => q;
    q.range = (a: number, b: number) => { range = [a, b]; return q; };
    q.then = (resolve: (v: unknown) => unknown) => {
      calls.push({ table, from: range[0], to: range[1] });
      if (table === failTable) return resolve({ data: null, error: { message: "boom" }, count: null });
      const all = tables[table] ?? [];
      return resolve({ data: all.slice(range[0], Math.min(range[1], range[0] + 999) + 1), error: null, count: all.length });
    };
    return q;
  };
  return { client: { from } as never, calls };
}
const log = (i: number) => ({ source: "web", offers_evaluated: 1, prefilter_candidates: 1, precise_route_calls: 1, compatible_count: 0, outcome: "none", latency_ms: 10, created_at: "2026-10-01T10:00:00Z", id: i });

describe("F1 KPI loader at volume and on errors", () => {
  it("reads past the 1000-row PostgREST cap: 2500 search-log rows are all counted", async () => {
    const { client, calls } = fakeAdmin({ carpool_search_log: Array.from({ length: 2500 }, (_, i) => log(i)) });
    const r = await loadCarpoolKpis(client, "org", 30, new Date("2026-10-02T00:00:00Z"));
    expect(r.search.searches).toBe(2500);
    expect(r.search.offersEvaluated).toBe(2500);
    expect(calls.filter((c) => c.table === "carpool_search_log").length).toBe(3);
  });
  it("a failing query THROWS (the page shows its error alert) instead of returning zeros", async () => {
    const { client } = fakeAdmin({}, "carpool_ride_requests");
    await expect(loadCarpoolKpis(client, "org", 30)).rejects.toThrow(/kpi query failed \(requests\): boom/);
  });
  it("chunks id lists to 100 per request", async () => {
    const seen: number[] = [];
    await chunked(Array.from({ length: 250 }, (_, i) => i), 100, async (c) => { seen.push(c.length); return []; });
    expect(seen).toEqual([100, 100, 50]);
  });
  it("pageAll continues while pages are full and stops on the first short page", async () => {
    let n = 0;
    const rows = await pageAll("x", async () => ({ data: n++ === 0 ? Array.from({ length: PAGE_SIZE }, () => 1) : [], error: null }));
    expect(rows.length).toBe(PAGE_SIZE);
    expect(n).toBe(2);
  });
});
