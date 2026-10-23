import {organizationMetricsAllowed} from "@/lib/operations/organizationMetrics";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { FmShell } from "../carpool/FmShell";
import { FmCarIcon, FmCheckIcon, FmGaugeIcon, FmUsersIcon } from "../fmIcons";
import { SettingsForm } from "./SettingsForm";
import { SafetyEquipmentSection } from "./SafetyEquipmentSection";
import { ChatUsageSummary } from "./ChatUsageSummary";
import { getChatUsageStats } from "../chat/queries";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDictionary, getLocale } from "../../lib/i18n/getLocale";
import { CarpoolPolicySection, type PolicyVersionView } from "./CarpoolPolicySection";
import { areaText } from "@/lib/i18n/areaText";
import { settingsMiscTexts } from "@/lib/i18n/areas/settingsMisc";
import { POLICY_COLUMNS, policyFromRow, type PolicyRow } from "@/lib/carpool/loadPolicy";

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
  const locale = await getLocale();
  const T = areaText(settingsMiscTexts, locale);

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

  if(!(await organizationMetricsAllowed(supabase)))return <FmShell active="settings" orgName={profile.organization?.name??"—"} userName={profile.full_name} role={profile.role} isFleetManager isAdministrator={isAdministrator} wide><p role="status">{T.orgWideNotice}</p><Link href="/fleet">{T.backToFleet}</Link></FmShell>;

  const [{ data: settings }, { data: equipmentItems }, chatUsageStats, { data: policyRows }] = await Promise.all([
    supabase
      .from("organization_settings")
      .select(
        "range_safety_buffer_percent, min_charge_hours_bev, min_refuel_hours_ice_or_phev, min_cleaning_hours, carpool_departure_tolerance_minutes, carpool_return_tolerance_minutes, maintenance_due_soon_km, traffic_restriction_enabled, booking_mode, early_pickup_grace_minutes",
      )
      .eq("organization_id", profile.organization_id)
      .single(),
    supabase
      .from("safety_equipment_items")
      .select("id, name").eq("enabled",true)
      .eq("organization_id", profile.organization_id)
      .order("created_at"),
    // RLS on chat_conversations/chat_messages only exposes a user's own rows — this org-wide
    // rollup needs the admin client, gated on the isFleetManager check already done above.
    getChatUsageStats(createSupabaseAdminClient(), profile.organization_id),
    // Phase C5: carpool policy versions (insert-only table; newest first).
    supabase
      .from("carpool_policy_settings")
      .select(`${POLICY_COLUMNS}, created_at`)
      .eq("organization_id", profile.organization_id)
      .order("policy_version", { ascending: false })
      .limit(10),
  ]);
  const policyVersions: PolicyVersionView[] = (policyRows ?? []).map((row) => ({
    version: row.policy_version,
    createdAt: row.created_at,
    values: policyFromRow(row as unknown as PolicyRow),
  }));

  const o = dict.ops.settings;
  const bookingMode = settings?.booking_mode ?? "ai_recommended";
  const bookingLabel =
    dict.settings.form.booking.modes[bookingMode as keyof typeof dict.settings.form.booking.modes]?.label ?? bookingMode;

  return (
    <FmShell
      active="settings"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={o.title}
      subtitle={o.subtitle}
      legacy
      wide
    >
      <section className="st-summary fm-kpis" aria-label={o.summaryLabel} data-testid="settings-summary" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div className="fm-kpi">
          <span className="fm-kpi-icon"><FmGaugeIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value">{settings?.range_safety_buffer_percent ?? 20}%</p>
            <p className="fm-kpi-label">{dict.settings.form.range.safetyBufferLabel}</p>
          </div>
        </div>
        <div className="fm-kpi">
          <span className="fm-kpi-icon" data-tone="violet"><FmCarIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value st-kpi-text">{bookingLabel}</p>
            <p className="fm-kpi-label">{dict.settings.form.booking.heading}</p>
          </div>
        </div>
        <div className="fm-kpi">
          <span className="fm-kpi-icon" data-tone="ok"><FmUsersIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value">{policyVersions[0] ? `v${policyVersions[0].version}` : "—"}</p>
            <p className="fm-kpi-label">{dict.carpool.policy.title}</p>
          </div>
        </div>
        <div className="fm-kpi">
          <span className="fm-kpi-icon" data-tone="warn"><FmCheckIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value">{(equipmentItems ?? []).length}</p>
            <p className="fm-kpi-label">{dict.settings.safetyEquipment.heading}</p>
          </div>
        </div>
      </section>

      <section className="st-grid">
        <SettingsForm
          dict={dict}
          initialValues={{
            rangeSafetyBufferPercent: settings?.range_safety_buffer_percent ?? 20,
            minChargeHoursBev: settings?.min_charge_hours_bev ?? 6,
            minRefuelHoursIceOrPhev: settings?.min_refuel_hours_ice_or_phev ?? 1,
            minCleaningHours: settings?.min_cleaning_hours ?? 1,
            carpoolDepartureToleranceMinutes: settings?.carpool_departure_tolerance_minutes ?? 30,
            carpoolReturnToleranceMinutes: settings?.carpool_return_tolerance_minutes ?? 30,
            maintenanceDueSoonKm: settings?.maintenance_due_soon_km ?? 1000,
            trafficRestrictionEnabled: settings?.traffic_restriction_enabled ?? true,
            bookingMode: settings?.booking_mode ?? "ai_recommended",
            earlyPickupGraceMinutes: settings?.early_pickup_grace_minutes ?? 15,
          }}
        />
        <div className="st-side">
          <div className="fm-panel"><SafetyEquipmentSection dict={dict} deactivateLabel={T.deactivate} items={equipmentItems ?? []} /></div>
          <div className="fm-panel"><ChatUsageSummary dict={dict} stats={chatUsageStats} /></div>
          <div className="fm-panel"><CarpoolPolicySection dict={dict} locale={locale} versions={policyVersions} /></div>
          <div className="fm-panel">
            <a href="/settings/mobility-points" className="fm-link">
              {dict.mobilityPoints.title} →
            </a>
          </div>
        </div>
      </section>
    </FmShell>
  );
}
