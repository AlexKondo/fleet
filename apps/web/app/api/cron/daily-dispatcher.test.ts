import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const jobs = vi.hoisted(() => ({
  license: vi.fn(),
  chat: vi.fn(),
  carpool: vi.fn(),
  retention: vi.fn(),
}));
vi.mock("./license-reminders/route", () => ({ GET: jobs.license }));
vi.mock("./chat-cleanup/route", () => ({ GET: jobs.chat }));
vi.mock("./carpool-expiry/route", () => ({ GET: jobs.carpool }));
vi.mock("./carpool-retention/route", () => ({ GET: jobs.retention }));

import { GET } from "./daily/route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/daily", { headers: auth ? { authorization: auth } : {} });
const saved = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  jobs.license.mockReset().mockResolvedValue(NextResponse.json({ sent: 2 }));
  jobs.chat.mockReset().mockResolvedValue(NextResponse.json({ deleted: 1 }));
  jobs.carpool.mockReset().mockResolvedValue(NextResponse.json({ expired: 0 }));
  jobs.retention.mockReset().mockResolvedValue(NextResponse.json({ purged: 0 }));
});
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("daily cron dispatcher", () => {
  it("fails closed without a configured secret, with a wrong header, or with no header, and runs no job", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer anything"))).status).toBe(401);
    process.env.CRON_SECRET = "s3cret";
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect((await GET(req())).status).toBe(401);
    expect(jobs.license).not.toHaveBeenCalled();
    expect(jobs.chat).not.toHaveBeenCalled();
    expect(jobs.carpool).not.toHaveBeenCalled();
    expect(jobs.retention).not.toHaveBeenCalled();
  });

  it("runs all four jobs in order with the same request and returns every result", async () => {
    const response = await GET(req("Bearer s3cret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      "license-reminders": { status: 200, body: { sent: 2 } },
      "chat-cleanup": { status: 200, body: { deleted: 1 } },
      "carpool-expiry": { status: 200, body: { expired: 0 } },
      "carpool-retention": { status: 200, body: { purged: 0 } },
    });
    expect(jobs.license.mock.calls[0]![0].headers.get("authorization")).toBe("Bearer s3cret");
  });

  it("one job throwing or returning an error does not stop the others, and the dispatcher reports 500", async () => {
    jobs.license.mockRejectedValue(new Error("smtp down"));
    jobs.chat.mockResolvedValue(NextResponse.json({ error: "db" }, { status: 500 }));
    const response = await GET(req("Bearer s3cret"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body["license-reminders"]).toEqual({ status: 500, body: { error: "smtp down" } });
    expect(body["chat-cleanup"].status).toBe(500);
    expect(body["carpool-expiry"]).toEqual({ status: 200, body: { expired: 0 } });
    expect(jobs.carpool).toHaveBeenCalledTimes(1);
  });
});
