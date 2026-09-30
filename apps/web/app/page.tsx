import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";

// A plain employee has no fleet-ops screen to land on — "Painel" is hidden from their nav
// (AppShell.tsx) since it's all fleet-wide approvals/tasks they can't act on, so their home
// is "Minhas Viagens" instead. Fleet managers/security keep the dashboard as before.
export default async function RootPage() {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/dashboard");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isFleetOps =
    profile?.role === "fleet_manager" || profile?.role === "administrator" || profile?.role === "security";
  redirect(isFleetOps ? "/dashboard" : "/trips");
}
