import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getAreaText } from "@/lib/i18n/areaText";
import { approvalsInAppTexts } from "@/lib/i18n/areas/approvalsInApp";
import { approvalEmailTexts, emailStatusKey } from "@/lib/i18n/areas/approvalEmail";
import { cleanUserText, formatWhen, type ApprovalPayload } from "@/lib/approvals/whatsappApproval";
import { isResultStatus } from "@/lib/approvals/emailResult";
import { FmShell } from "../carpool/FmShell";
import { decideInApp } from "./actions";

export const dynamic = "force-dynamic";

interface PendingRow extends ApprovalPayload {
  reservation_id: string;
  created_at: string;
}

/** "Aprovar reservas": the direct manager sees the pending requests of the people they manage and decides inside the platform. */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");
  const { r } = await searchParams;
  const T = await getAreaText(approvalsInAppTexts);
  const E = await getAreaText(approvalEmailTexts);

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization:organizations(name)")
    .eq("id", user.id)
    .single();
  const { data } = await supabase.rpc("fm_manager_pending_approvals");
  const rows = Array.isArray(data) ? (data as unknown as PendingRow[]) : [];
  const outcome = isResultStatus(r) ? E[emailStatusKey(r)] : r === "generic_error" ? E.genericError : null;
  const isManager = profile?.role === "fleet_manager" || profile?.role === "administrator";

  return (
    <FmShell
      active="reservationApprovals"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isManager}
      isAdministrator={profile?.role === "administrator"}
      title={T.title}
      subtitle={T.subtitle}
      nonDrivingWorkspace
    >
      {outcome ? (
        <p role="status" className="fm-banner" data-testid="approvals-outcome" style={{ marginTop: 0, marginBottom: 16 }}>{outcome}</p>
      ) : null}
      {rows.length === 0 ? (
        <p className="fm-card" style={{ padding: 20 }} data-testid="approvals-empty">{T.empty}</p>
      ) : (
        <>
          <p style={{ marginBottom: 12, color: "var(--fm-text-muted)" }} data-testid="approvals-count">{T.count.replace("{count}", String(rows.length))}</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 16 }}>
            {rows.map((row) => {
              const vehicle = [cleanUserText(row.vehicle_name, 60), row.plate ? `(${cleanUserText(row.plate, 12)})` : ""].filter(Boolean).join(" ");
              const details: [string, string][] = [
                [E.requester, cleanUserText(row.requester_name, 80)],
                [E.vehicle, vehicle || "—"],
                [E.departure, formatWhen(row.departure_at)],
                [E.returnAt, formatWhen(row.return_at)],
                [E.origin, cleanUserText(row.origin)],
                [E.destination, cleanUserText(row.destination)],
                [E.purpose, cleanUserText(row.purpose, 240)],
                [E.passengers, String(row.passengers)],
              ];
              const approve = decideInApp.bind(null, row.reservation_id, "approve");
              const reject = decideInApp.bind(null, row.reservation_id, "reject");
              return (
                <li key={row.reservation_id} className="fm-card" style={{ padding: 20 }} data-testid={`approval-card-${row.reservation_id}`}>
                  <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", marginBottom: 14 }}>
                    {details.map(([label, value]) => (
                      <div key={label} style={{ display: "contents" }}>
                        <dt style={{ color: "var(--fm-text-muted)" }}>{label}</dt>
                        <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <form action={approve}><button type="submit" className="fm-btn fm-btn-primary" data-testid="inapp-approve">{E.approve}</button></form>
                    <form action={reject}><button type="submit" className="fm-btn" data-testid="inapp-reject">{E.reject}</button></form>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </FmShell>
  );
}
