"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";

export type GanttZoomLevel = "week" | "month" | "quarter";

export async function setGanttZoomPreference(zoom: GanttZoomLevel): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return;
  await supabase.from("profiles").update({ gantt_zoom_preference: zoom }).eq("id", user.id);
}
