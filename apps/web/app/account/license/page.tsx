import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary } from "../../../lib/i18n/getLocale";
import { FmShell } from "../../carpool/FmShell";
import { Card } from "../../ui/Card";
import { LicenseCaptureForm } from "./LicenseCaptureForm";

export default async function LicensePage() {
  const supabase = await createSupabaseServerClient();
  const dict = await getDictionary();

  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";

  // FIX-VISUAL: FleetMind shell (was the legacy AppShell). The content keeps its markup, restyled by `.fm-legacy`.
  // No nonDrivingWorkspace here, so the CNH gate is exactly the AppShell one (loadShellContext's licenseGateActive).
  return (
    <FmShell
      active="dashboard"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={dict.account.license.title}
      legacy
    >
      <section className="mx-auto max-w-md px-6 py-8">
        <Card>
          <LicenseCaptureForm dict={dict} />
        </Card>
      </section>
    </FmShell>
  );
}
