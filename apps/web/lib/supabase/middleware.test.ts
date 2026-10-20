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
    vi.doMock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));
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
    vi.doMock("@supabase/ssr",()=>({createServerClient:()=>({auth:{getUser:async()=>({data:{user:{id:"disabled",email:"member@example.invalid"}}})},rpc:async()=>({data:false,error:null})})}));
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
