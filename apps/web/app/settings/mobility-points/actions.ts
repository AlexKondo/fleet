"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  createCorporateMobilityPoint,
  deactivateCorporateMobilityPoint,
  deleteCorporateMobilityPoint,
  updateCorporateMobilityPoint,
} from "@/lib/geospatial/corporateMobilityPoints";
import { createGooglePlacesProvider } from "@/lib/geospatial/googlePlacesProvider";

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

const ADDRESS_NOT_FOUND = "Não encontrei esse endereço no mapa. Escreva o endereço completo (rua, número, cidade).";

/** Nobody types coordinates: they come from the address (the same Google geocoder, Cost Guard-metered, the trip form uses). */
async function coordinatesFor(organizationId: string, address: string): Promise<{ latitude: number; longitude: number } | null> {
  if (!address) return null;
  const out = await createGooglePlacesProvider(organizationId, { geocodeKind: "map_geocode" }).geocode(address);
  if (out.status !== "ok") return null;
  const { lat, lng } = out.location.coordinates;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
}

/** "a, b, c" -> ["a","b","c"] (blank pieces dropped). */
function parseAliases(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "").split(",").map((a) => a.trim()).filter(Boolean);
}

export async function createMobilityPoint(
  _prevState: MobilityPointActionState,
  formData: FormData,
): Promise<MobilityPointActionState> {
  const auth = await requireFleetManager();
  if (!auth.ok) return { status: "error", error: "not_authorized" };

  const name = String(formData.get("name") ?? "").trim();
  const addressLabel = String(formData.get("addressLabel") ?? "").trim();
  const where = await coordinatesFor(auth.organizationId, addressLabel);
  if (!where) return { status: "error", error: ADDRESS_NOT_FOUND };
  const { latitude, longitude } = where;
  const category = String(formData.get("category") ?? "").trim() || null;
  const aliases = parseAliases(formData.get("aliases"));

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
  const where = await coordinatesFor(auth.organizationId, addressLabel);
  if (!where) return { status: "error", error: ADDRESS_NOT_FOUND };
  const { latitude, longitude } = where;
  const category = String(formData.get("category") ?? "").trim() || null;
  const aliases = parseAliases(formData.get("aliases"));

  const result = await updateCorporateMobilityPoint(auth.supabase, {
    id,
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

export async function deactivateMobilityPoint(id: string): Promise<void> {
  const auth = await requireFleetManager();
  if (!auth.ok) return;

  await deactivateCorporateMobilityPoint(auth.supabase, id);
  revalidatePath("/settings/mobility-points");
}

export async function deleteMobilityPoint(id: string): Promise<void> {
  const auth = await requireFleetManager();
  if (!auth.ok) return;

  await deleteCorporateMobilityPoint(auth.supabase, id);
  revalidatePath("/settings/mobility-points");
}
