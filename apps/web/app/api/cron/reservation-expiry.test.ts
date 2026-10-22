import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** FIX-VENCIDAS R5: the no-show release cron route (fail-closed auth + service-role RPC call). */
const admin = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: admin.rpc }) }));

import { GET } from "./reservation-expiry/route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/reservation-expiry", { headers: auth ? { authorization: auth } : {} });
const saved = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  vi.stubEnv("FM_ENABLE_AUTO_RESERVATION_RELEASE","true");
  admin.rpc.mockReset().mockResolvedValue({
    data: { released: 2, vehicles_released: 1, skipped_with_activity: 1, skipped_locked: 0 },
    error: null,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("cron reservation-expiry", () => {
  it("fails closed (no secret, wrong or missing header) and never calls the RPC", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer anything"))).status).toBe(401);
    process.env.CRON_SECRET = "s3cret";
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect((await GET(req())).status).toBe(401);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("calls fm_release_expired_reservations for every organization and returns its counts", async () => {
    const response = await GET(req("Bearer s3cret"));
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("fm_release_expired_reservations", {});
    expect(await response.json()).toEqual({ released: 2, vehicles_released: 1, skipped_with_activity: 1, skipped_locked: 0 });
  });

  it("an RPC error is reported as 500 (visible in the cron log)", async () => {
    admin.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const response = await GET(req("Bearer s3cret"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "reservation_expiry_unavailable" });
  });
});

it('disabled policy skips RPC even with a valid cron secret',async()=>{vi.stubEnv('FM_ENABLE_AUTO_RESERVATION_RELEASE','false');expect(await (await GET(req('Bearer s3cret'))).json()).toEqual({released:0,skipped:'disabled_by_policy'});expect(admin.rpc).not.toHaveBeenCalled();});
