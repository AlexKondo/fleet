import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), redirects: [] as string[] }));
class RedirectSignal extends Error {}
vi.mock("next/navigation", () => ({ redirect: (url: string) => { h.redirects.push(url); throw new RedirectSignal(url); } }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: (...a: unknown[]) => h.rpc(...a) }) }));

import { decideByEmail } from "./actions";
import { isResultStatus, storedStateToStatus } from "@/lib/approvals/emailResult";

const TOKEN = "d".repeat(64);
const run = async (token: string, decision: "approve" | "reject") => { try { await decideByEmail(token, decision); } catch (e) { if (!(e instanceof RedirectSignal)) throw e; } };

beforeEach(() => {
  h.redirects.length = 0;
  h.rpc.mockReset().mockResolvedValue({ data: { status: "approved", reservation_id: "r1" }, error: null });
});

describe("decideByEmail (server action on the e-mail confirmation page)", () => {
  it("forwards the decision through the e-mail channel with no phone and goes back to the page with the outcome", async () => {
    await run(TOKEN, "approve");
    expect(h.rpc).toHaveBeenCalledWith("fm_approval_decide", { p_token: TOKEN, p_decision: "approve", p_from_phone: "", p_message_id: null, p_channel: "email" });
    expect(h.redirects).toEqual([`/aprovar/${TOKEN}?r=approved`]);
  });
  it("reject, and every business outcome, is shown back to the manager", async () => {
    for (const status of ["rejected", "expired", "already_decided", "vehicle_unavailable", "not_authorized", "superseded", "invalid"]) {
      h.redirects.length = 0;
      h.rpc.mockResolvedValue({ data: { status }, error: null });
      await run(TOKEN, "reject");
      expect(h.redirects).toEqual([`/aprovar/${TOKEN}?r=${status}`]);
    }
  });
  it("a malformed token or decision never reaches the database", async () => {
    await run("not-a-token", "approve");
    await run(TOKEN, "maybe" as never);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.redirects).toEqual(["/aprovar/x?r=generic_error", `/aprovar/${TOKEN}?r=generic_error`]);
  });
  it("a database failure shows a generic error without leaking the reason", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "secret detail" } });
    await run(TOKEN, "approve");
    expect(h.redirects).toEqual([`/aprovar/${TOKEN}?r=generic_error`]);
    h.redirects.length = 0;
    h.rpc.mockRejectedValue(new Error("boom"));
    await run(TOKEN, "approve");
    expect(h.redirects).toEqual([`/aprovar/${TOKEN}?r=generic_error`]);
  });
  it("only known statuses are shown; stored request states map to their explanation", () => {
    expect(isResultStatus("approved")).toBe(true);
    expect(isResultStatus("<script>")).toBe(false);
    expect(isResultStatus(undefined)).toBe(false);
    expect(storedStateToStatus("approved")).toBe("already_decided");
    expect(storedStateToStatus("rejected")).toBe("already_decided");
    expect(storedStateToStatus("cancelled")).toBe("superseded");
    expect(storedStateToStatus("expired")).toBe("expired");
    expect(storedStateToStatus("???")).toBe("generic_error");
  });
});
