import { describe, it, expect, vi, afterEach } from "vitest";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { loadCommandCenter } from "./loadCommandCenter";

// Query emulator applies every relevant filter and page; foreign organization
// records deliberately remain in fixtures to detect accidental scope leaks.
function dbFixture(fail?: string, extra = 0) {
  const vehicles = [
    {
      id: "v1",
      organization_id: "a",
      status: "available",
      current_location_id: "l1",
    },
    {
      id: "v2",
      organization_id: "a",
      status: "blocked",
      current_location_id: "l2",
    },
    {
      id: "foreign",
      organization_id: "b",
      status: "available",
      current_location_id: "l1",
    },
    ...Array.from({ length: extra }, (_, i) => ({
      id: `more${i}`,
      organization_id: "a",
      status: "available",
      current_location_id: "l1",
    })),
  ];
  const rows: Record<string, Record<string, unknown>[]> = {
    vehicles,
    vehicle_locations: [
      { id: "l1", organization_id: "a", name: "Site 1" },
      { id: "l2", organization_id: "a", name: "Site 2" },
    ],
    reservations: [
      {
        id: "r1",
        organization_id: "a",
        vehicle_id: "v1",
        trip_request_id: "t1",
        status: "confirmed",
        start_at: "2026-10-16T14:00:00Z",
      },
      {
        id: "r2",
        organization_id: "a",
        vehicle_id: "v2",
        trip_request_id: "t2",
        status: "completed",
        start_at: "2026-10-16T16:00:00Z",
      },
      {
        id: "old",
        organization_id: "a",
        vehicle_id: "v1",
        trip_request_id: "t0",
        status: "confirmed",
        start_at: "2026-09-16T14:00:00Z",
      },
    ],
    workflow_tasks: [
      { id: "task1", organization_id: "a", vehicle_id: "v1", status: "open" },
      { id: "task2", organization_id: "a", vehicle_id: "v2", status: "open" },
    ],
    carpool_offers: [
      { id: "o1", organization_id: "a", trip_request_id: "t1" },
      { id: "o2", organization_id: "a", trip_request_id: "t2" },
    ],
    carpool_ride_requests: [
      {
        id: "ride1",
        organization_id: "a",
        carpool_offer_id: "o1",
        status: "ACCEPTED",
        requested_seats: 2,
      },
      {
        id: "ride2",
        organization_id: "a",
        carpool_offer_id: "o2",
        status: "PENDING",
        requested_seats: 1,
      },
    ],
  };
  const from = vi.fn((table: string) => {
    const source = table === "fm_managed_ride_requests" ? "carpool_ride_requests" : table.replace(/^fm_managed_/, "");
    let found = rows[source] ?? [];
    let start = 0;
    let end = Infinity;
    const q = {
      select: () => q,
      is:(k:string,v:unknown)=>{found=found.filter(r=>(r[k]??null)===v);return q;},
      eq: (k: string, v: unknown) => {
        found = found.filter((r) => r[k] === v);
        return q;
      },
      in: (k: string, v: unknown[]) => {
        found = found.filter((r) => v.includes(r[k]));
        return q;
      },
      gte: (k: string, v: string) => {
        found = found.filter((r) => String(r[k]) >= v);
        return q;
      },
      lt: (k: string, v: string) => {
        found = found.filter((r) => String(r[k]) < v);
        return q;
      },
      order: () => q,
      range: (a: number, b: number) => {
        start = a;
        end = b;
        return q;
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          resolve({
            data: source === fail ? null : found.slice(start, end + 1),
            error: source === fail ? { message: "offline" } : null,
          }),
        ),
    };
    return q;
  });
  return { from } as unknown as TypedSupabaseClient;
}
afterEach(() => vi.useRealTimers());
describe("command center data integrity", () => {
  it("scopes vehicles, reservations, tasks and accepted rides to the same current location", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-10-16T17:00:00Z"));
    const report = await loadCommandCenter(dbFixture(), "a", "today", "l1");
    expect(report.vehicles?.map((v) => v.id)).toEqual(["v1"]);
    expect(report.reservations?.map((r) => r.id)).toEqual(["r1"]);
    expect(report.tasks?.map((t) => t.id)).toEqual(["task1"]);
    expect(report.rides?.map((r) => r.id)).toEqual(["ride1"]);
    expect(report.daily.map((d) => d.count)).toEqual([1]);
    expect(report.degraded).toBe(false);
  });
  it("loads past the server row cap without dropping vehicles", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-10-16T17:00:00Z"));
    const report = await loadCommandCenter(
      dbFixture(undefined, 1200),
      "a",
      "today",
    );
    expect(report.vehicles).toHaveLength(1202);
    expect(report.reservations).toHaveLength(2);
    expect(report.rides).toHaveLength(1);
  });
  it("retains query failure as null and never reports false zeros for a filtered fleet", async () => {
    const report = await loadCommandCenter(
      dbFixture("vehicles"),
      "a",
      "today",
      "l1",
    );
    expect(report.vehicles).toBeNull();
    expect(report.reservations).toBeNull();
    expect(report.tasks).toBeNull();
    expect(report.rides).toBeNull();
    expect(report.degraded).toBe(true);
  });
  it("does not turn a failed carpool source into zero accepted rides", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-10-16T17:00:00Z"));
    const report = await loadCommandCenter(
      dbFixture("carpool_ride_requests"),
      "a",
      "today",
    );
    expect(report.rides).toBeNull();
    expect(report.degraded).toBe(true);
    expect(report.reservations).toHaveLength(2);
  });
});
