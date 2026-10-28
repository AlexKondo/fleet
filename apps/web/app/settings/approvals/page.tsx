import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary } from "@/lib/i18n/getLocale";
import { getAreaText } from "@/lib/i18n/areaText";
import { approvalsTexts } from "@/lib/i18n/areas/approvals";
import { approvalChannelConfigured } from "@/lib/approvals/dispatchApproval";
import { getRoleLabels } from "../users/ROLE_LABELS";
import { FmShell } from "../../carpool/FmShell";
import { ApprovalRow } from "./ApprovalRow";

interface SnapshotRow {
  user_id: string;
  manager_id: string | null;
  phone_e164: string | null;
  consent: boolean;
}

/** Administrator only: direct manager of each person + the manager's WhatsApp (approval by WhatsApp, migration 0229). */
export default async function ApprovalsSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");
  const dict = await getDictionary();
  const T = await getAreaText(approvalsTexts);

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "administrator") redirect("/settings");

  const [{ data: people }, { data: snapshot }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").eq("organization_id", profile.organization_id).order("full_name"),
    supabase.rpc("fm_approval_channel_snapshot"),
  ]);
  const byUser = new Map<string, SnapshotRow>();
  for (const row of Array.isArray(snapshot) ? (snapshot as unknown as SnapshotRow[]) : []) byUser.set(row.user_id, row);
  const roleLabels = getRoleLabels(dict);
  const members = (people ?? []).map((p) => ({ id: p.id, name: p.full_name, role: p.role }));
  const managedCount = new Map<string, number>();
  for (const row of byUser.values()) if (row.manager_id) managedCount.set(row.manager_id, (managedCount.get(row.manager_id) ?? 0) + 1);
  const hasPhone = (id: string) => Boolean(byUser.get(id)?.phone_e164 && byUser.get(id)?.consent);

  return (
    <FmShell
      active="settings"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager
      isAdministrator
      title={T.title}
      subtitle={T.subtitle}
      legacy
      wide
    >
      <div role="status" className={"fm-banner"} style={{ marginTop: 0, marginBottom: 12 }} data-testid="channel-state">
        {approvalChannelConfigured() ? T.channelOn : T.channelOff}
      </div>
      <p className="text-sm text-fog-400" style={{ marginBottom: 16 }}>{T.howItWorks}</p>
      <section className="fm-panel">
        {members.length === 0 ? (
          <p>{T.empty}</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-widest text-fog-600">
                <th className="px-3 py-2">{T.colPerson}</th>
                <th className="px-3 py-2">{T.colRole}</th>
                <th className="px-3 py-2">{T.colManager}</th>
                <th className="px-3 py-2">{T.colWhatsapp}</th>
                <th className="px-3 py-2">{T.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const row = byUser.get(m.id);
                const managerId = row?.manager_id ?? "";
                const statusKey = !managerId ? "statusNoManager" : hasPhone(managerId) ? "statusReady" : "statusManagerNoPhone";
                return (
                  <ApprovalRow
                    key={m.id}
                    person={{ id: m.id, name: m.name, roleLabel: roleLabels[m.role] ?? m.role }}
                    managerId={managerId}
                    phone={row?.phone_e164 ?? ""}
                    consent={row?.consent ?? false}
                    managedCount={managedCount.get(m.id) ?? 0}
                    managerOptions={members.map((x) => ({ id: x.id, name: x.name }))}
                    T={T}
                    statusKey={statusKey}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </FmShell>
  );
}
