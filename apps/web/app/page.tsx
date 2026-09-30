import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";

// Neither a plain employee nor a pure security/gate user has any use for "Painel" (it's
// all fleet-wide approvals/tasks/active-reservation management, hidden from their nav in
// AppShell.tsx) — an employee's home is "Minhas Viagens", security's is "Movimentações"
// (their whole job is the pickup/return checklist there). Fleet managers/administrators
// keep the dashboard as their home.
export default async function RootPage() {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/dashboard");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role === "fleet_manager" || profile?.role === "administrator") redirect("/dashboard");
  if (profile?.role === "security") redirect("/gate");
  redirect("/trips");
}
