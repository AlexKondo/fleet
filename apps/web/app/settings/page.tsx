import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { AppShell } from "../AppShell";
import { SettingsForm } from "./SettingsForm";
import { SafetyEquipmentSection } from "./SafetyEquipmentSection";
import { getDictionary } from "../../lib/i18n/getLocale";

/**
 * Organization-level configurability (fleet-car-saas.txt §8 "Range Safety Buffer
 * configurável", §12 Predictive Maintenance, §15 São Paulo Traffic Restriction
 * Intelligence): before this page existed, organization_settings could only be edited
 * with a raw SQL UPDATE. Visible/editable only to fleet_manager/administrator, same
 * pattern as apps/web/app/analytics/page.tsx.
 */
export default async function SettingsPage() {
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

  const [{ data: settings }, { data: equipmentItems }] = await Promise.all([
    supabase
      .from("organization_settings")
      .select(
        "range_safety_buffer_percent, min_charge_hours_bev, min_refuel_hours_ice_or_phev, min_cleaning_hours, carpool_departure_tolerance_minutes, carpool_return_tolerance_minutes, maintenance_due_soon_days, traffic_restriction_enabled, booking_mode, early_pickup_grace_minutes",
      )
      .eq("organization_id", profile.organization_id)
      .single(),
    supabase
      .from("safety_equipment_items")
      .select("id, name")
      .eq("organization_id", profile.organization_id)
      .order("created_at"),
  ]);

  return (
    <AppShell
      active="settings"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={dict.settings.title}
    >

      <section className="px-6 py-6">
        <SettingsForm
          dict={dict}
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
            earlyPickupGraceMinutes: settings?.early_pickup_grace_minutes ?? 15,
          }}
        />
        <SafetyEquipmentSection dict={dict} items={equipmentItems ?? []} />
      </section>
    </AppShell>
  );
}
