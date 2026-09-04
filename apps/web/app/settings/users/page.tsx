import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppShell } from "../../AppShell";
import { InviteUserModal } from "./InviteUserModal";
import { UserRow } from "./UserRow";
import { ROLE_LABELS } from "./ROLE_LABELS";

/**
 * Team management: create/read/update/delete for the people inside an organization —
 * until this page existed, the only way to add a second user to an org (or change
 * anyone's role) was a direct SQL insert/update, same gap fleet/page.tsx closed for
 * vehicles. Administrator-only (see actions.ts requireAdministrator) since this surface
 * can grant 'administrator' itself.
 */
export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();

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
    >
      <header className="flex items-center justify-between border-b border-line-800 px-6 py-4">
        <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
          Equipe
        </p>
        <InviteUserModal />
      </header>

      {profilesError ? (
        <div
          role="alert"
          className="border-b border-signal-red/40 bg-signal-red/10 px-6 py-3 text-sm text-signal-red"
        >
          Não foi possível carregar a equipe agora. Tente novamente em instantes.
        </div>
      ) : null}

      <section className="px-6 py-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
          Membros ({members.length})
        </h2>

        <ul className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
            />
          ))}
        </ul>

        <p className="text-xs text-fog-600">
          Funções: {Object.entries(ROLE_LABELS).map(([, label]) => label).join(" · ")}.
        </p>
      </section>
    </AppShell>
  );
}
