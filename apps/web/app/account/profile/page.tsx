import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary } from "../../../lib/i18n/getLocale";
import { AppShell } from "../../AppShell";
import { Card } from "../../ui/Card";
import { UpdateProfileForm } from "./UpdateProfileForm";

export default async function ProfilePage() {
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

  return (
    <AppShell
      active="dashboard"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={dict.account.profile.title}
    >
      <section className="mx-auto max-w-md px-6 py-8">
        <Card>
          <UpdateProfileForm dict={dict} fullName={profile?.full_name ?? ""} email={user.email ?? ""} />
        </Card>
      </section>
    </AppShell>
  );
}
