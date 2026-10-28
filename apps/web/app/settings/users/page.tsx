import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FmShell } from "../../carpool/FmShell";
import { FmAlertIcon, FmCheckIcon, FmUsersIcon } from "../../fmIcons";
import { InviteUserModal } from "./InviteUserModal";
import Link from "next/link";
import { getAreaText } from "@/lib/i18n/areaText";
import { approvalsTexts } from "@/lib/i18n/areas/approvals";
import { UserRow } from "./UserRow";
import { UserTable } from "./UserTable";
import { getRoleLabels } from "./ROLE_LABELS";
import { pageAll } from "@/lib/carpool/kpi/loadKpis";
import { getDictionary, getLocale } from "../../../lib/i18n/getLocale";

/**
 * Team management: create/read/update/deactivate for the people inside an organization —
 * until this page existed, the only way to add a second user to an org (or change
 * anyone's role) was a direct SQL insert/update, same gap fleet/page.tsx closed for
 * vehicles. Administrator-only (see actions.ts requireAdministrator) since this surface
 * can grant 'administrator' itself.
 */
function toSource(s: string | null | undefined): "ai" | "manual" | null {
  return s === "ai" ? "ai" : s === "manual" ? "manual" : null;
}

export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();
  const dict = await getDictionary();
  const locale = await getLocale();
  const approvalsT = await getAreaText(approvalsTexts);

  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "administrator") redirect("/settings");

  // 0063: names/roles come from profiles; the license columns are revoked at column level and are
  // served to fleet_manager/administrator only by the role-checked list_member_licenses() definer
  // function (merged here by id).
  const [profileResult, { data: licenseRows, error: licensesError }, { data: sourceRows }, accessResult] = await Promise.all([
    pageAll("team profiles", (a,b)=>supabase.from("profiles").select("id, full_name, role").eq("organization_id", profile.organization_id).order("id").range(a,b)).then(data=>({data,error:false})).catch(()=>({data:null,error:true})),
    supabase.rpc("list_member_licenses"),
    // migration 0074: how each expiration got there. Fail-soft: on an error every member shows "Origem nao registrada"
    // (the page and the license fields are never affected).
    supabase.rpc("list_member_license_sources"),
    supabase.rpc("fm_member_access_snapshot"),
  ]);
  const {data: baseProfiles,error: profilesError}=profileResult;
  const accessById = new Map<string,{enabled:boolean;version:number}>();
  if (!accessResult.error && Array.isArray(accessResult.data)) {
    for (const row of accessResult.data) {
      if (row && typeof row === "object" && !Array.isArray(row) && typeof row.id === "string" && typeof row.enabled === "boolean" && typeof row.version === "number")
        accessById.set(row.id,{enabled:row.enabled,version:row.version});
    }
  }
  // M3: when the license read fails the page must NOT pretend the licenses are blank (the forms used to post
  // those blanks back and wipe the CNH): surface the error and render the license/authorization controls disabled.
  const licensesAvailable = !licensesError && Array.isArray(licenseRows);
  const licenseById = new Map((licenseRows ?? []).map((l) => [l.id, l]));
  const sourceById = new Map((Array.isArray(sourceRows) ? sourceRows : []).map((r) => [r.id, r.drivers_license_expiration_source]));
  const profiles = (baseProfiles ?? []).map((p) => {
    const l = licenseById.get(p.id);
    return {
      ...p,
      enabled: accessById.get(p.id)?.enabled ?? null,
      accessVersion: accessById.get(p.id)?.version,
      accessRequestId: randomUUID(),
      driver_authorized: l?.driver_authorized ?? false,
      drivers_license_number: l?.drivers_license_number ?? null,
      drivers_license_category: l?.drivers_license_category ?? null,
      drivers_license_expiration: l?.drivers_license_expiration ?? null,
      drivers_license_expiration_source: toSource(sourceById.get(p.id)),
    };
  });

  // profiles has no email column (0001_init_schema.sql) — email lives on auth.users,
  // which only the service-role client can read for anyone other than yourself.
  const admin = createSupabaseAdminClient();
  const members = await Promise.all(
    (profiles ?? []).map(async (p) => {
      const { data } = await admin.auth.admin.getUserById(p.id);
      return { ...p, email: data.user?.email ?? "—" };
    }),
  );

  const o = dict.ops.users;
  const roleLabels = getRoleLabels(dict);
  const roleCounts = new Map<string, number>();
  for (const m of members) roleCounts.set(m.role, (roleCounts.get(m.role) ?? 0) + 1);
  const authorizedCount = members.filter((m) => m.driver_authorized).length;
  const noLicenseCount = members.filter((m) => !m.drivers_license_number).length;

  return (
    <FmShell
      active="team"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager
      isAdministrator
      title={o.title}
      subtitle={o.subtitle}
      legacy
      wide
      headerActions={
        <>
          {/* where each person's WhatsApp and direct manager are registered (approval and WhatsApp use) */}
          <Link href="/settings/approvals" className="fm-btn" data-testid="whatsapp-shortcut">{approvalsT.teamShortcut}</Link>
          <InviteUserModal dict={dict} />
        </>
      }
    >

      {profilesError ? (
        <div
          role="alert"
          className="fm-banner fm-banner-danger"
          style={{ marginTop: 0, marginBottom: 16 }}
        >
          {dict.team.loadError}
        </div>
      ) : null}
      {!licensesAvailable ? (
        <div
          role="alert"
          data-testid="license-load-error"
          className="fm-banner fm-banner-danger"
          style={{ marginTop: 0, marginBottom: 16 }}
        >
          {dict.team.licenseLoadError}
        </div>
      ) : null}

      <section className="us-summary fm-kpis" aria-label={o.summaryLabel} data-testid="users-summary" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        <div className="fm-kpi" data-testid="users-kpi-total">
          <span className="fm-kpi-icon"><FmUsersIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value">{members.length}</p>
            <p className="fm-kpi-label">{o.kpiTotal}</p>
          </div>
        </div>
        <div className="fm-kpi" data-testid="users-kpi-authorized">
          <span className="fm-kpi-icon" data-tone="ok"><FmCheckIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value">{licensesAvailable ? authorizedCount : "—"}</p>
            <p className="fm-kpi-label">{o.kpiAuthorized}</p>
          </div>
        </div>
        <div className="fm-kpi" data-testid="users-kpi-nolicense">
          <span className="fm-kpi-icon" data-tone={licensesAvailable && noLicenseCount > 0 ? "warn" : "ok"}><FmAlertIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value">{licensesAvailable ? noLicenseCount : "—"}</p>
            <p className="fm-kpi-label">{o.kpiNoLicense}</p>
          </div>
        </div>
        <div className="fm-kpi fm-kpi-roles" data-testid="users-kpi-roles">
          <div className="fm-kpi-body" style={{ gridColumn: "1 / -1" }}>
            <p className="fm-kpi-label">{o.kpiByRole}</p>
            <ul className="fm-legend">
              {[...roleCounts.entries()].map(([r, n]) => (
                <li key={r}>
                  <span>{roleLabels[r] ?? r}</span>
                  <strong>{n}</strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="fm-panel us-wrap">
        <h2 className="fm-h2">
          {dict.team.membersHeading.replace("{count}", String(members.length))}
        </h2>

        <UserTable
          dict={dict}
          members={members.map((m) => ({
            id: m.id,
            fullName: m.full_name,
            email: m.email,
            node: (
              <UserRow
                key={m.id}
                locale={locale}
                member={{
                  id: m.id,
                  full_name: m.full_name,
                  email: m.email,
                  role: m.role,
                  enabled: m.enabled,
                  accessVersion: m.accessVersion,
                  accessRequestId: m.accessRequestId,
                  driver_authorized: m.driver_authorized,
                  drivers_license_number: m.drivers_license_number,
                  drivers_license_category: m.drivers_license_category,
                  drivers_license_expiration: m.drivers_license_expiration,
                  drivers_license_expiration_source: m.drivers_license_expiration_source,
                }}
                isSelf={m.id === user.id}
                licensesAvailable={licensesAvailable}
                dict={dict}
              />
            ),
          }))}
        />

        <p className="text-xs text-fog-600" data-testid="roles-legend">
          {dict.team.rolesLegend.replace(
            "{roles}",
            Object.values(getRoleLabels(dict)).join(" · "),
          )}
        </p>
      </section>
    </FmShell>
  );
}
