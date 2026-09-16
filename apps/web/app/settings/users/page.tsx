import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppShell } from "../../AppShell";
import { InviteUserModal } from "./InviteUserModal";
import { UserRow } from "./UserRow";
import { getRoleLabels } from "./ROLE_LABELS";
import { getDictionary } from "../../../lib/i18n/getLocale";

/**
 * Team management: create/read/update/delete for the people inside an organization —
 * until this page existed, the only way to add a second user to an org (or change
 * anyone's role) was a direct SQL insert/update, same gap fleet/page.tsx closed for
 * vehicles. Administrator-only (see actions.ts requireAdministrator) since this surface
 * can grant 'administrator' itself.
 */
export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();
  const dict = await getDictionary();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "administrator") redirect("/settings");

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select(
      "id, full_name, role, driver_authorized, drivers_license_number, drivers_license_category, drivers_license_expiration",
    )
    .eq("organization_id", profile.organization_id)
    .order("full_name");

  // profiles has no email column (0001_init_schema.sql) — email lives on auth.users,
  // which only the service-role client can read for anyone other than yourself.
  const admin = createSupabaseAdminClient();
  const members = await Promise.all(
    (profiles ?? []).map(async (p) => {
      const { data } = await admin.auth.admin.getUserById(p.id);
      return { ...p, email: data.user?.email ?? "—" };
    }),
  );

  return (
    <AppShell
      active="team"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager
      isAdministrator
      title={dict.team.title}
      headerActions={<InviteUserModal dict={dict} />}
    >

      {profilesError ? (
        <div
          role="alert"
          className="border-b border-signal-red/40 bg-signal-red/10 px-6 py-3 text-sm text-signal-red"
        >
          {dict.team.loadError}
        </div>
      ) : null}

      <section className="px-6 py-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
          {dict.team.membersHeading.replace("{count}", String(members.length))}
        </h2>

        <div className="mb-6 overflow-x-auto rounded-md border border-line-800">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-800 text-left text-xs uppercase tracking-widest text-fog-600">
                <th className="px-4 py-3 font-medium">{dict.team.columns.member}</th>
                <th className="px-4 py-3 font-medium">{dict.team.columns.role}</th>
                <th className="px-4 py-3 font-medium">{dict.team.columns.license}</th>
                <th className="px-4 py-3 font-medium text-right">{dict.team.columns.action}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <UserRow
                  key={m.id}
                  member={{
                    id: m.id,
                    full_name: m.full_name,
                    email: m.email,
                    role: m.role,
                    driver_authorized: m.driver_authorized,
                    drivers_license_number: m.drivers_license_number,
                    drivers_license_category: m.drivers_license_category,
                    drivers_license_expiration: m.drivers_license_expiration,
                  }}
                  isSelf={m.id === user.id}
                  dict={dict}
                />
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-fog-600">
          {dict.team.rolesLegend.replace(
            "{roles}",
            Object.values(getRoleLabels(dict)).join(" · "),
          )}
        </p>
      </section>
    </AppShell>
  );
}
