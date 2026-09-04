import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingsForm } from "./SettingsForm";

/**
 * Organization-level configurability (fleet-car-saas.txt §8 "Range Safety Buffer
 * configurável", §12 Predictive Maintenance, §15 São Paulo Traffic Restriction
 * Intelligence): before this page existed, organization_settings could only be edited
 * with a raw SQL UPDATE. Visible/editable only to fleet_manager/administrator, same
 * pattern as apps/web/app/analytics/page.tsx.
 */
export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  if (!profile || !isFleetManager) {
    redirect("/dashboard");
  }

  const { data: settings } = await supabase
    .from("organization_settings")
    .select("*")
    .eq("organization_id", profile.organization_id)
    .single();

  return (
    <main className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-line-800 px-6 py-4">
        <div>
          <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
            Fleet<span className="text-signal-amber">.</span> Configurações
          </p>
          <p className="text-xs uppercase tracking-widest text-fog-600">
            {profile.organization?.name ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {profile.role === "administrator" ? (
            <Link
              href="/settings/users"
              className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
            >
              Equipe
            </Link>
          ) : null}
          <Link
            href="/dashboard"
            className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
          >
            ← Painel
          </Link>
        </div>
      </header>

      <section className="px-6 py-6">
        <SettingsForm
          initialValues={{
            rangeSafetyBufferPercent: settings?.range_safety_buffer_percent ?? 20,
            minChargeHoursBev: settings?.min_charge_hours_bev ?? 6,
            minRefuelHoursIceOrPhev: settings?.min_refuel_hours_ice_or_phev ?? 1,
            minCleaningHours: settings?.min_cleaning_hours ?? 1,
            carpoolDepartureToleranceMinutes: settings?.carpool_departure_tolerance_minutes ?? 30,
            carpoolReturnToleranceMinutes: settings?.carpool_return_tolerance_minutes ?? 30,
            maintenanceDueSoonDays: settings?.maintenance_due_soon_days ?? 14,
            trafficRestrictionEnabled: settings?.traffic_restriction_enabled ?? true,
            bookingMode: settings?.booking_mode ?? "ai_recommended",
          }}
        />
      </section>
    </main>
  );
}
