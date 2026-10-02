import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const admin = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  const p: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (r: (v: unknown) => unknown) => r({ data: [], error: null, count: 0 });
      return () => p;
    },
  });
  void chain;
  return { client: { from: () => p, rpc: async () => ({ data: 0, error: null }) } };
});
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => admin.client }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/email/renderEmail", () => ({ renderEmail: () => ({ html: "", text: "" }) }));

import { GET as carpool } from "./carpool-expiry/route";
import { GET as retention } from "./carpool-retention/route";
import { GET as chat } from "./chat-cleanup/route";
import { GET as license } from "./license-reminders/route";

const routes = { "carpool-expiry": carpool, "carpool-retention": retention, "chat-cleanup": chat, "license-reminders": license };
const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/x", { headers: auth ? { authorization: auth } : {} });
const saved = process.env.CRON_SECRET;
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe.each(Object.entries(routes))("cron route %s auth", (_name, GET) => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  it("no secret configured -> 401 even with an Authorization header (fail closed)", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer anything"))).status).toBe(401);
    expect((await GET(req())).status).toBe(401);
  });
  it("wrong or missing header -> 401", async () => {
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect((await GET(req())).status).toBe(401);
  });
  it("correct header -> proceeds (not 401)", async () => {
    expect((await GET(req("Bearer s3cret"))).status).not.toBe(401);
  });
});
