"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  createCorporateMobilityPoint,
  deactivateCorporateMobilityPoint,
  updateCorporateMobilityPoint,
} from "@/lib/geospatial/corporateMobilityPoints";

export interface MobilityPointActionState {
  status: "idle" | "success" | "error";
  error?: string;
}

async function requireFleetManager() {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { ok: false as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "fleet_manager" && profile.role !== "administrator")) {
    return { ok: false as const };
  }
  return { ok: true as const, supabase, organizationId: profile.organization_id };
}

export async function createMobilityPoint(
  _prevState: MobilityPointActionState,
  formData: FormData,
): Promise<MobilityPointActionState> {
  const auth = await requireFleetManager();
  if (!auth.ok) return { status: "error", error: "not_authorized" };

  const name = String(formData.get("name") ?? "").trim();
  const addressLabel = String(formData.get("addressLabel") ?? "").trim();
  const latitude = Number(formData.get("latitude"));
  const longitude = Number(formData.get("longitude"));
  const category = String(formData.get("category") ?? "").trim() || null;
  const aliasesRaw = String(formData.get("aliases") ?? "").trim();
  const aliases = aliasesRaw ? aliasesRaw.split(",").map((a) => a.trim()).filter(Boolean) : [];

  const result = await createCorporateMobilityPoint(auth.supabase, {
    organizationId: auth.organizationId,
    name,
    addressLabel,
    latitude,
    longitude,
    category,
    aliases,
  });

  if (result.status === "error") {
    return { status: "error", error: result.message };
  }

  revalidatePath("/settings/mobility-points");
  return { status: "success" };
}

export async function updateMobilityPoint(
  _prevState: MobilityPointActionState,
  formData: FormData,
): Promise<MobilityPointActionState> {
  const auth = await requireFleetManager();
  if (!auth.ok) return { status: "error", error: "not_authorized" };

  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", error: "invalid_values" };

  const name = String(formData.get("name") ?? "").trim();
  const addressLabel = String(formData.get("addressLabel") ?? "").trim();
  const latitude = Number(formData.get("latitude"));
  const longitude = Number(formData.get("longitude"));
  const category = String(formData.get("category") ?? "").trim() || null;

  const result = await updateCorporateMobilityPoint(auth.supabase, {
    id,
    name,
    addressLabel,
    latitude,
    longitude,
    category,
  });

  if (result.status === "error") {
    return { status: "error", error: result.message };
  }

  revalidatePath("/settings/mobility-points");
  return { status: "success" };
}

export async function deactivateMobilityPoint(id: string): Promise<void> {
  const auth = await requireFleetManager();
  if (!auth.ok) return;

  await deactivateCorporateMobilityPoint(auth.supabase, id);
  revalidatePath("/settings/mobility-points");
}
