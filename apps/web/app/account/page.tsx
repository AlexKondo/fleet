import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary } from "../../lib/i18n/getLocale";
import { AppShell } from "../AppShell";
import { Card } from "../ui/Card";
import { ChangePasswordForm } from "./ChangePasswordForm";

/**
 * Any authenticated role can reach this — unlike /settings, which is manager-only. An
 * admin can set a member's password on /settings/users, but until this page existed
 * there was no way for that member (or anyone) to change it themselves afterward.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ forcePasswordChange?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const dict = await getDictionary();
  const { forcePasswordChange } = await searchParams;

  const user = await getCurrentUser(supabase);
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";

  return (
    <AppShell
      active="dashboard"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={dict.account.title}
    >
      <section className="mx-auto max-w-md px-6 py-8">
        {forcePasswordChange === "1" ? (
          <p
            role="alert"
            className="mb-6 rounded-sm border border-gwm-accent/40 bg-gwm-accent/10 px-4 py-3 text-sm text-gwm-accent"
          >
            {dict.account.forcedChangeNotice}
          </p>
        ) : null}
        <p className="mb-6 text-sm text-fog-400">{dict.account.description}</p>
        <Card>
          <ChangePasswordForm dict={dict} forced={forcePasswordChange === "1"} />
        </Card>
      </section>
    </AppShell>
  );
}
