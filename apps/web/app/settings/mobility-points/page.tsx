import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { AppShell } from "../../AppShell";
import { getDictionary } from "../../../lib/i18n/getLocale";
import { listCorporateMobilityPoints } from "@/lib/geospatial/corporateMobilityPoints";
import { MobilityPointsSection } from "./MobilityPointsSection";

/**
 * Phase C2 — minimal admin screen for Corporate Mobility Points (pack §9): list, create,
 * edit, deactivate. fleet_manager/administrator only, same gate as /settings itself.
 * Deliberately not wired into the carpool matching/search path — that's Phase C3.
 */
export default async function MobilityPointsPage() {
  const supabase = await createSupabaseServerClient();
  const dict = await getDictionary();

  const user = await getCurrentUser(supabase);
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";
  if (!profile || !isFleetManager) {
    redirect("/dashboard");
  }

  const result = await listCorporateMobilityPoints(supabase, profile.organization_id, {
    includeInactive: true,
  });
  const points = result.status === "ok" ? result.data : [];

  return (
    <AppShell
      active="settings"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={dict.mobilityPoints.title}
    >
      <section className="px-6 py-6">
        <MobilityPointsSection dict={dict} points={points} />
      </section>
    </AppShell>
  );
}
