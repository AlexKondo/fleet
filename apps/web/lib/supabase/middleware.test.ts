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
