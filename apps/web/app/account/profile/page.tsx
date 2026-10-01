import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary } from "../../../lib/i18n/getLocale";
import { AppShell } from "../../AppShell";
import { BackButton } from "../../BackButton";
import { getOwnLicense } from "../../../lib/auth/ownLicense";
import { Card } from "../../ui/Card";
import { UpdateProfileForm } from "./UpdateProfileForm";

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const dict = await getDictionary();

  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, ownLicense] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, role, avatar_url, organization:organizations(name)")
      .eq("id", user.id)
      .single(),
    // 0063: license columns are only readable through the own-row definer function.
    getOwnLicense(supabase),
  ]);

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
        <BackButton dict={dict} />
        <Card>
          <UpdateProfileForm
            dict={dict}
            fullName={profile?.full_name ?? ""}
            email={user.email ?? ""}
            avatarUrl={profile?.avatar_url ?? null}
            license={
              ownLicense?.number
                ? {
                    number: ownLicense.number,
                    category: ownLicense.category,
                    expirationDate: ownLicense.expiration,
                  }
                : null
            }
          />
        </Card>
      </section>
    </AppShell>
  );
}
