import { describe, expect, it, vi } from "vitest";
import { sendWhatsAppNotice } from "./sendNotice";

const env = { approvalUrl: "https://n8n.invalid/webhook/fleet-approval-request", secret: "s" };

describe("sendWhatsAppNotice", () => {
  it("is skipped while n8n is not configured", async () => {
    expect(await sendWhatsAppNotice({ to: "+55", text: "x" }, { env: {} })).toEqual({ status: "skipped", reason: "not_configured" });
  });
  it("posts the signed notice with at most 3 buttons to the fleet-notify webhook", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    const r = await sendWhatsAppNotice(
      { to: "+5511900000001", text: "oi", title: "T", buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `B${i}` })) },
      { env, fetch: fetchMock as unknown as typeof fetch, now: () => 1_700_000_000_000 },
    );
    expect(r).toEqual({ status: "sent" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://n8n.invalid/webhook/fleet-notify");
    const body = JSON.parse(String(init.body)) as { to: string; text: string; buttons: unknown[] };
    expect(body.to).toBe("+5511900000001");
    expect(body.buttons).toHaveLength(3);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });
  it("a refusal from n8n is a failure the outbox retries", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 502 }));
    expect(await sendWhatsAppNotice({ to: "+55", text: "x" }, { env, fetch: fetchMock as unknown as typeof fetch })).toEqual({ status: "failed", error: "http_502" });
  });
});
