import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: (...a: unknown[]) => m.sendEmail(...a) }));

import { POST } from "./route";
import { NextRequest } from "next/server";

const req = (body: unknown, token: string | null = "s3cret") =>
  new NextRequest("https://x.invalid/api/whatsapp/health", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

describe("POST /api/whatsapp/health", () => {
  beforeEach(() => {
    m.sendEmail.mockReset().mockResolvedValue({ success: true });
    process.env.WHATSAPP_ALERT_SECRET = "s3cret";
    delete process.env.WHATSAPP_ALERT_TO;
  });

  it("refuses without the secret, with a wrong one, or when none is configured", async () => {
    expect((await POST(req({ state: "down" }, null))).status).toBe(401);
    expect((await POST(req({ state: "down" }, "wrong"))).status).toBe(401);
    delete process.env.WHATSAPP_ALERT_SECRET;
    expect((await POST(req({ state: "down" }))).status).toBe(401);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
  it("refuses an unknown state", async () => {
    expect((await POST(req({ state: "boom" }))).status).toBe(400);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
  it("down / stuck / ok e-mail the alert address in Portuguese with the Brasília time", async () => {
    for (const state of ["down", "stuck", "ok"]) {
      m.sendEmail.mockClear();
      const res = await POST(req({ state, detail: "Disconnected <b>" }));
      expect(res.status).toBe(200);
      const mail = m.sendEmail.mock.calls[0]![0] as { to: string; subject: string; html: string; text: string };
      expect(mail.to).toBe("alexandre.kondo@gmail.com");
      expect(mail.subject).toContain("WhatsApp");
      expect(mail.text).toContain("Horário (Brasília)");
      expect(mail.html).not.toContain("<b>");
    }
  });
  it("answers 502 when the e-mail could not be sent, so the monitor tries again", async () => {
    m.sendEmail.mockResolvedValue({ success: false });
    expect((await POST(req({ state: "down" }))).status).toBe(502);
  });
});
