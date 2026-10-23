import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("./env", () => ({ getSupabasePublicEnv: () => ({ url: "http://localhost", anonKey: "k" }) }));

import { updateSupabaseSession } from "./middleware";

const fwd = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe("middleware header hygiene (L6 + identity headers)", () => {
  it("strips client-supplied identity / license headers on public routes", async () => {
    const req = new NextRequest("http://localhost/login", {
      headers: { "x-fleet-user-id": "forged", "x-fleet-user-email": "evil@x", "x-fleet-license-missing": "0" },
    });
    const res = await updateSupabaseSession(req);
    expect(fwd(res, "x-fleet-user-id")).toBeNull();
    expect(fwd(res, "x-fleet-user-email")).toBeNull();
    expect(fwd(res, "x-fleet-license-missing")).toBeNull();
  });
});

describe("/api/geo/* without a session", () => {
  it("answers 401 JSON (no-store), never a redirect to /login", async () => {
    vi.resetModules();
    vi.doMock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }) }, rpc: async () => ({ data: true, error: null }), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }));
    const { updateSupabaseSession: run } = await import("./middleware");
    for (const path of ["/api/geo/autocomplete", "/api/geo/route-map"]) {
      const res = await run(new NextRequest(`http://localhost${path}`, { method: "POST" }));
      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "not_authenticated" });
    }
    const page = await run(new NextRequest("http://localhost/trips/new"));
    expect(page.status).toBe(307);
    vi.doUnmock("@supabase/ssr");
  });
});

describe("deactivated session",()=>{
  it("blocks pages and API requests before forwarding verified identity",async()=>{
    vi.resetModules();
    vi.doMock("@supabase/ssr",()=>({createServerClient:()=>({auth:{getUser:async()=>({data:{user:{id:"disabled",email:"member@example.invalid"}}}),getSession:async()=>({data:{session:{user:{id:"disabled"}}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})}),rpc:async()=>({data:false,error:null})})}));
    const {updateSupabaseSession:run}=await import("./middleware");
    const page=await run(new NextRequest("http://localhost/dashboard",{headers:{"x-fleet-user-id":"forged"}}));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login?access=unavailable");
    expect(fwd(page,"x-fleet-user-id")).toBeNull();
    const api=await run(new NextRequest("http://localhost/api/geo/autocomplete"));
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({error:"account_unavailable"});
    vi.doUnmock("@supabase/ssr");
  });
});

// S3-03: the CNH gate blocks DRIVING routes only; management roles keep their administrative workspaces.
describe("CNH gate versus administrative access (S3-03)", () => {
  type License = { drivers_license_number: string | null; drivers_license_expiration: string | null; driver_authorized: boolean };
  const NO_CNH: License = { drivers_license_number: null, drivers_license_expiration: null, driver_authorized: false };
  const EXPIRED: License = { drivers_license_number: "12345678900", drivers_license_expiration: "2026-01-10", driver_authorized: true };
  const ADMIN_PATHS = ["/", "/admin", "/admin/units", "/admin/integrations", "/admin/audit", "/admin/ai", "/analytics", "/analytics/carpool", "/dashboard", "/dashboard/command-center", "/gate", "/gate/exceptions", "/gate/history", "/fleet", "/fleet/carpools", "/settings/users", "/maintenance/planning", "/reservations/abc"];
  const DRIVING_PATHS = ["/trips/new", "/reservations/abc/pickup"];

  async function load(opts: { role: string; license: License; enabled?: boolean; mustChange?: boolean }) {
    vi.resetModules();
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id: "u1", email: "u1@example.invalid", app_metadata: { must_change_password: opts.mustChange ?? false } } } }), getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
        rpc: async (name: string) => ({ error: null, data: name === "fm_account_enabled" ? (opts.enabled ?? true) : [opts.license] }),
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: opts.role }, error: null }) }) }) }),
      }),
    }));
    const { updateSupabaseSession: run } = await import("./middleware");
    return (path: string) => run(new NextRequest(`http://localhost${path}`));
  }
  const toLicense = (res: Response) => res.status === 307 && (res.headers.get("location") ?? "").includes("/account/license");

  it.each([
    ["administrator without CNH", "administrator", NO_CNH],
    ["fleet manager with expired CNH", "fleet_manager", EXPIRED],
  ])("%s reaches every administrative route and keeps the CNH notice, but driving routes stay gated", async (_label, role, license) => {
    const go = await load({ role, license });
    for (const path of ADMIN_PATHS) {
      const res = await go(path);
      expect(res.status, path).toBe(200);
      expect(fwd(res, "x-fleet-license-missing"), path).toBe("1");
    }
    for (const path of DRIVING_PATHS) expect(toLicense(await go(path)), path).toBe(true);
    vi.doUnmock("@supabase/ssr");
  });

  it("maintenance operator without CNH reaches its workspaces and the dashboard; driving stays gated", async () => {
    const go = await load({ role: "maintenance_operator", license: NO_CNH });
    for (const path of ["/maintenance", "/maintenance/work-orders", "/fleet", "/dashboard"]) expect((await go(path)).status, path).toBe(200);
    for (const path of ["/trips/new", "/reservations/abc/pickup"]) expect(toLicense(await go(path)), path).toBe(true);
    vi.doUnmock("@supabase/ssr");
  });

  it("security stays exempt (gate staff do not drive)", async () => {
    const go = await load({ role: "security", license: NO_CNH });
    for (const path of ["/gate", "/gate/history", "/dashboard", "/trips"]) expect((await go(path)).status, path).toBe(200);
    vi.doUnmock("@supabase/ssr");
  });

  it("employee with expired or missing CNH can read and ride while driving remains gated", async () => {
    for (const license of [EXPIRED, NO_CNH]) {
      const go = await load({ role: "employee", license });
      for (const path of ["/dashboard", "/admin", "/analytics", "/gate", "/fleet", "/reservations/abc", "/trips", "/carpool", "/carpool/mine", "/"]) expect((await go(path)).status, path).toBe(200);
      for (const path of ["/trips/new", "/reservations/abc/pickup"]) expect(toLicense(await go(path)), path).toBe(true);
      for (const path of ["/account", "/account/license", "/reservations/abc/return"]) expect((await go(path)).status, path).toBe(200);
    }
    vi.doUnmock("@supabase/ssr");
  });

  it("a deactivated account is still blocked before any administrative exemption", async () => {
    const go = await load({ role: "administrator", license: NO_CNH, enabled: false });
    for (const path of ["/admin", "/dashboard", "/analytics"]) {
      const res = await go(path);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login?access=unavailable");
    }
    vi.doUnmock("@supabase/ssr");
  });

  it("the initial password change still comes before any administrative exemption", async () => {
    const go = await load({ role: "fleet_manager", license: EXPIRED, mustChange: true });
    for (const path of ["/admin", "/dashboard/command-center", "/gate"]) {
      const res = await go(path);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("forcePasswordChange=1");
    }
    vi.doUnmock("@supabase/ssr");
  });
});
