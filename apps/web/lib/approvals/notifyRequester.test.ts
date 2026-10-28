import { describe, expect, it, vi } from "vitest";
import { verifySignature } from "./whatsappApproval";
import { buildRequesterMessage, noticeUrl, notifyRequesterOutcome, type NoticeDeps } from "./notifyRequester";

const ENV = { approvalUrl: "https://n8n.example.invalid/webhook/fleet-approval-request", secret: "s3cret" };
const NOTICE = { ok: true, phone_e164: "+5511982593096", status: "confirmed", plate: "CCD0710", vehicle_name: "Ora 05 BEV", origin: "Fábrica", destination: "EZ Tower", departure_at: "2026-10-29T12:00:00Z", return_at: "2026-10-29T21:00:00Z" };
const deps = (data: unknown, over: Partial<NoticeDeps> = {}): NoticeDeps => ({ rpc: async () => ({ data, error: null }), env: ENV, now: () => 1_800_000_000_000, ...over });

describe("notice endpoint", () => {
  it("is the sibling of the approval webhook unless set explicitly", () => {
    expect(noticeUrl(ENV)).toBe("https://n8n.example.invalid/webhook/fleet-notify");
    expect(noticeUrl({ ...ENV, notifyUrl: "https://other.invalid/x" })).toBe("https://other.invalid/x");
    expect(noticeUrl({})).toBeNull();
  });
});

describe("message", () => {
  it("approval: says it is approved, with vehicle, times and destination", () => {
    const text = buildRequesterMessage("approve", NOTICE);
    expect(text).toContain("aprovada");
    expect(text).toContain("Ora 05 BEV (CCD0710)");
    expect(text).toContain("Destino: EZ Tower");
    expect(text).toMatch(/Saída: .* às 09:00/);
  });
  it("refusal: says it was refused and what to do next", () => {
    const text = buildRequesterMessage("reject", NOTICE);
    expect(text).toContain("recusada");
    expect(text).toContain("novo pedido");
  });
  it("user text cannot add WhatsApp formatting", () => {
    expect(buildRequesterMessage("approve", { ...NOTICE, destination: "*Hack* _x_" })).toContain("Destino: Hack x");
  });
});

describe("notifyRequesterOutcome", () => {
  it("posts a signed notice to n8n for a requester with a registered number", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    const r = await notifyRequesterOutcome("r1", "approve", deps(NOTICE, { fetch: f as unknown as typeof fetch }));
    expect(r).toEqual({ status: "sent" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://n8n.example.invalid/webhook/fleet-notify");
    const headers = init.headers as Record<string, string>;
    expect(verifySignature({ rawBody: String(init.body), secret: "s3cret", timestamp: headers["x-fleet-timestamp"]!, signature: headers["x-fleet-signature"]!, nowSeconds: 1_800_000_000 })).toBe(true);
    expect(JSON.parse(String(init.body))).toMatchObject({ type: "requester_notice", to: "+5511982593096", reservation_id: "r1" });
  });
  it("sends nothing when the requester has no number, or the channel is not configured", async () => {
    const f = vi.fn();
    expect(await notifyRequesterOutcome("r1", "approve", deps({ ok: false, reason: "no_phone" }, { fetch: f as unknown as typeof fetch }))).toEqual({ status: "skipped", reason: "no_phone" });
    expect(await notifyRequesterOutcome("r1", "approve", deps(NOTICE, { env: {}, fetch: f as unknown as typeof fetch }))).toEqual({ status: "skipped", reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });
  it("never throws: a failing n8n or network is reported", async () => {
    expect(await notifyRequesterOutcome("r1", "approve", deps(NOTICE, { fetch: (async () => new Response("x", { status: 502 })) as unknown as typeof fetch }))).toEqual({ status: "failed", error: "http_502" });
    expect(await notifyRequesterOutcome("r1", "approve", deps(NOTICE, { fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch }))).toMatchObject({ status: "failed" });
  });
});
