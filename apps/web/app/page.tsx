import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";

// Landing page per role. A plain employee lands on the FleetMind v2.0 Home (/dashboard renders
// EmployeeHome for employees: next trip, quick actions, carpool requests); security lands on
// "Movimentações" (their whole job is the pickup/return checklist there); fleet managers and
// administrators keep the dashboard (Command Center). Any other role (maintenance operator) keeps
// "Minhas Viagens".
export default async function RootPage() {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/dashboard");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role === "fleet_manager" || profile?.role === "administrator") redirect("/dashboard");
  if (profile?.role === "security") redirect("/gate");
  if (profile?.role === "employee") redirect("/dashboard");
  redirect("/trips");
}
