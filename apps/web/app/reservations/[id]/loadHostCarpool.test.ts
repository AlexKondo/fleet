import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/carpool/loadPolicy", () => ({ loadLatestPolicy: vi.fn() }));
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import { loadHostCarpool, placesForHost, type HostPlaceRow } from "./loadHostCarpool";

const row = (over: Partial<HostPlaceRow> = {}): HostPlaceRow => ({
  request_id: "r", rider_id: "u", status: "PENDING", pickup_label: "Rua Augusta, Consolação", dropoff_label: "Av. Paulista, Bela Vista", is_exact: false, ...over,
});

describe("placesForHost (0064)", () => {
  it("PENDING: coarse labels, flagged not exact", () => {
    expect(placesForHost("PENDING", row())).toEqual({ pickupLabel: "Rua Augusta, Consolação", dropoffLabel: "Av. Paulista, Bela Vista", placesExact: false });
  });
  it("ACCEPTED: full labels, exact", () => {
    expect(placesForHost("ACCEPTED", row({ status: "ACCEPTED", is_exact: true, pickup_label: "Rua Augusta, 1500 - Consolação" })).placesExact).toBe(true);
  });
  it("PENDING never claims exact even if a row says so", () => {
    expect(placesForHost("PENDING", row({ is_exact: true })).placesExact).toBe(false);
  });
  it.each(["REJECTED", "CANCELLED", "EXPIRED", "INVALIDATED"])("%s: nothing shown", (s) => {
    expect(placesForHost(s, row({ status: s }))).toEqual({ pickupLabel: null, dropoffLabel: null, placesExact: false });
  });
  it("no place row: nothing shown", () => {
    expect(placesForHost("PENDING", undefined).pickupLabel).toBeNull();
  });
});

// S3-01: trip_participants has two FKs to profiles (passenger_id and left_by, 0185). PostgREST answers an
// unqualified `profiles(...)` embed with PGRST201; this fake behaves the same way.
describe("loadHostCarpool confirmed passengers (S3-01)", () => {
  const AMBIGUOUS = { code: "PGRST201", message: "Could not embed because more than one relationship was found for 'trip_participants' and 'profiles'" };
  function fakeClient(opts: { participantsFail?: boolean; requestsFail?: boolean } = {}) {
    const selects: Record<string, string> = {};
    const result = (table: string, columns: string) => {
      if (table === "carpool_offers") return { data: [{ id: "o1", status: "active", seats_offered: 3, seats_available: 1 }], error: null };
      if (table === "trip_participants") {
        if (opts.participantsFail || /passenger:profiles\(/.test(columns)) return { data: null, error: AMBIGUOUS };
        return { data: [
          { id: "p1", passenger_id: "u-mariana", passenger_count: 1, passenger: { full_name: "Mariana Teixeira" } },
          { id: "p2", passenger_id: "u-thiago", passenger_count: 1, passenger: { full_name: "Thiago Souza" } },
        ], error: null };
      }
      if (table === "carpool_ride_requests") return opts.requestsFail ? { data: null, error: { code: "42501", message: "denied" } } : { data: [], error: null };
      return { data: [], error: null };
    };
    const client = {
      from(table: string) {
        let columns = "";
        const chain: Record<string, unknown> = {
          select(c: string) { columns = c; selects[table] = c; return chain; },
          eq() { return chain; }, in() { return chain; }, order() { return chain; },
          then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return Promise.resolve(result(table, columns)).then(resolve, reject); },
        };
        return chain;
      },
      rpc: async () => ({ data: [], error: null }),
    };
    return { client: client as never, selects };
  }

  it("names the passenger FK and lists both accepted passengers", async () => {
    vi.mocked(loadLatestPolicy).mockResolvedValue({ ok: true, policy: { carpoolEnabled: true } } as never);
    const { client, selects } = fakeClient();
    const data = await loadHostCarpool(client, "org", "trip");
    expect(selects.trip_participants).toContain("profiles!trip_participants_passenger_id_fkey(full_name)");
    expect(data.participantsUnavailable).toBe(false);
    expect(data.participants.map((p) => p.name)).toEqual(["Mariana Teixeira", "Thiago Souza"]);
  });

  it("a failed passenger read is reported as unavailable, never as 'no passengers'", async () => {
    vi.mocked(loadLatestPolicy).mockResolvedValue({ ok: true, policy: { carpoolEnabled: false } } as never);
    const { client } = fakeClient({ participantsFail: true });
    const data = await loadHostCarpool(client, "org", "trip");
    expect(data.participantsUnavailable).toBe(true);
    expect(data.participants).toEqual([]);
    expect(data.showSection).toBe(true);
  });

  it("a failed ride-request read is reported as unavailable", async () => {
    vi.mocked(loadLatestPolicy).mockResolvedValue({ ok: true, policy: { carpoolEnabled: true } } as never);
    const { client } = fakeClient({ requestsFail: true });
    const data = await loadHostCarpool(client, "org", "trip");
    expect(data.requestsUnavailable).toBe(true);
    expect(data.pending).toEqual([]);
  });
});
