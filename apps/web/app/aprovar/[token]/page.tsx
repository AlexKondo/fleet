import type { Metadata } from "next";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAreaText } from "@/lib/i18n/areaText";
import { approvalEmailTexts, emailStatusKey } from "@/lib/i18n/areas/approvalEmail";
import { cleanUserText, formatWhen, type ApprovalPayload } from "@/lib/approvals/whatsappApproval";
import { isResultStatus, storedStateToStatus } from "@/lib/approvals/emailResult";
import { decideByEmail } from "./actions";
import "../../carpool/fm-theme.css";

export const dynamic = "force-dynamic";
// the link carries a secret token: never indexed, never sent as a referrer
export const metadata: Metadata = { title: "FleetMind", robots: { index: false, follow: false }, referrer: "no-referrer" };

const TOKEN = /^[0-9a-f]{32,128}$/;

/**
 * Public confirmation page opened from the approval e-mail. Opening it only READS the request (fm_approval_peek); the decision is taken
 * by the two buttons, which post a server action. No session: the single-use token in the link authenticates the manager.
 */
export default async function ApprovalEmailPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string }> }) {
  const { token } = await params;
  const { r } = await searchParams;
  const T = await getAreaText(approvalEmailTexts);

  let status = "invalid";
  let payload: ApprovalPayload | null = null;
  let expiresAt = "";
  if (TOKEN.test(token)) {
    try {
      const admin = createSupabaseAdminClient();
      const { data } = await admin.rpc("fm_approval_peek", { p_token: token });
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const d = data as { status?: string; payload?: ApprovalPayload; expires_at?: string };
        status = d.status ?? "invalid";
        payload = d.payload ?? null;
        expiresAt = d.expires_at ?? "";
      }
    } catch {
      status = "error";
    }
  }
  // right after a decision: the outcome of THAT tap (e.g. a vehicle that is no longer available) wins over the stored state
  const justDecided = isResultStatus(r) ? r : r === "generic_error" ? "generic_error" : null;

  const vehicle = payload ? [cleanUserText(payload.vehicle_name, 60), payload.plate ? `(${cleanUserText(payload.plate, 12)})` : ""].filter(Boolean).join(" ") : "";
  const rows: [string, string][] = payload
    ? [
        [T.requester, cleanUserText(payload.requester_name, 80)],
        [T.vehicle, vehicle || "—"],
        [T.departure, formatWhen(payload.departure_at)],
        [T.returnAt, formatWhen(payload.return_at)],
        [T.origin, cleanUserText(payload.origin)],
        [T.destination, cleanUserText(payload.destination)],
        [T.purpose, cleanUserText(payload.purpose, 240)],
        [T.passengers, String(payload.passengers)],
      ]
    : [];

  // the text to show: the outcome of the tap just made, or why an old link is no longer usable; nothing while it is still pending
  const message = justDecided
    ? T[emailStatusKey(justDecided)]
    : status === "pending"
      ? null
      : T[emailStatusKey(storedStateToStatus(status === "error" ? "error" : status))];
  const showButtons = status === "pending" && !justDecided;
  const approve = decideByEmail.bind(null, token, "approve");
  const reject = decideByEmail.bind(null, token, "reject");

  return (
    <div className="fm-theme" style={{ display: "block", minHeight: "100dvh", padding: "24px 16px" }}>
      <main style={{ maxWidth: 560, margin: "0 auto" }} data-testid="approval-email-page">
        <p className="fm-topbar-brand" style={{ display: "block", marginBottom: 16 }}>FleetMind</p>
        <section className="fm-card" style={{ padding: 20 }}>
          <h1 className="fm-title" style={{ fontSize: 22, marginBottom: 8 }}>{T.title}</h1>
          {payload ? (
            <>
              <p style={{ marginBottom: 12 }}>{T.intro.replace("{name}", cleanUserText(payload.requester_name, 80))}</p>
              <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", marginBottom: 12 }}>
                {rows.map(([label, value]) => (
                  <div key={label} style={{ display: "contents" }}>
                    <dt style={{ color: "var(--fm-text-muted)" }}>{label}</dt>
                    <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd>
                  </div>
                ))}
              </dl>
              {expiresAt && status === "pending" ? <p style={{ color: "var(--fm-text-muted)", marginBottom: 12 }}>{T.validUntil} {formatWhen(expiresAt)}.</p> : null}
            </>
          ) : null}
          {message ? (
            <p role="status" className="fm-banner" data-testid="approval-email-result" style={{ marginTop: 0 }}>
              {message} {status !== "invalid" ? T.backHint : ""}
            </p>
          ) : null}
          {showButtons ? (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <form action={approve}><button type="submit" className="fm-btn fm-btn-primary" data-testid="approve-button">{T.approve}</button></form>
                <form action={reject}><button type="submit" className="fm-btn" data-testid="reject-button">{T.reject}</button></form>
              </div>
              <p style={{ color: "var(--fm-text-muted)", fontSize: 13, marginTop: 14 }}>{T.noteSafe}</p>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
