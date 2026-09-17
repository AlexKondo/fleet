"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { getDictionary } from "@/lib/i18n/getLocale";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface FleetActionState {
  status: "idle" | "success" | "error";
  error?: string;
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Uploads the vehicle's own reference photo to the same private `vehicle-photos` bucket
 * the pickup/return checklists use (0002_operational_cycle.sql) — its RLS policy only
 * checks that the first path segment equals the uploader's organization_id, so a
 * `<org_id>/vehicles/<vehicle_id>.<ext>` path needs no new bucket or policy. `upsert:
 * true` lets re-uploading replace the previous photo at the same path.
 */
async function uploadVehiclePhoto(
  supabase: TypedSupabaseClient,
  organizationId: string,
  vehicleId: string,
  file: File,
  dict: Dictionary,
): Promise<{ path: string } | { error: string }> {
  if (!file.type.startsWith("image/")) {
    return { error: dict.errors.fleet.photoMustBeImage };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { error: dict.errors.fleet.photoTooLarge };
  }
  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(file.name);
  const extension = extensionMatch ? extensionMatch[1] : "jpg";
  const storagePath = `${organizationId}/vehicles/${vehicleId}.${extension}`;

  const { error } = await supabase.storage
    .from("vehicle-photos")
    .upload(storagePath, file, { upsert: true, contentType: file.type || undefined });
  if (error) return { error: dict.errors.fleet.photoUploadFailed };

  return { path: storagePath };
}

async function requireFleetManager() {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { supabase, organizationId: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  return { supabase, organizationId: isFleetManager ? (profile?.organization_id ?? null) : null };
}

export async function createLocation(
  _prevState: FleetActionState,
  formData: FormData,
): Promise<FleetActionState> {
  const { supabase, organizationId } = await requireFleetManager();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { status: "error", error: dict.errors.fleet.locationNameRequired };

  const { error } = await supabase
    .from("vehicle_locations")
    .insert({ organization_id: organizationId, name });
  if (error) return { status: "error", error: error.message };

  revalidatePath("/fleet");
  return { status: "success" };
}

export async function updateLocation(
  _prevState: FleetActionState,
  formData: FormData,
): Promise<FleetActionState> {
  const { supabase, organizationId } = await requireFleetManager();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { status: "error", error: dict.errors.fleet.locationNameRequired };

  const { error } = await supabase
    .from("vehicle_locations")
    .update({ name })
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) return { status: "error", error: error.message };

  revalidatePath("/fleet");
  return { status: "success" };
}

export async function deleteLocation(
  _prevState: FleetActionState,
  formData: FormData,
): Promise<FleetActionState> {
  const { supabase, organizationId } = await requireFleetManager();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", error: dict.errors.fleet.locationInvalid };

  const { error } = await supabase
    .from("vehicle_locations")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) {
    // 23503 = foreign_key_violation (Postgres error code) — a vehicle still has this
    // as its home or current location. Deleting reference data out from under an
    // existing vehicle would silently orphan that vehicle's location, so the DB
    // correctly refuses it; translate that into something a fleet manager can act on.
    const inUse = error.code === "23503";
    return {
      status: "error",
      error: inUse ? dict.errors.fleet.locationInUse : error.message,
    };
  }

  revalidatePath("/fleet");
  return { status: "success" };
}

export async function createCategory(
  _prevState: FleetActionState,
  formData: FormData,
): Promise<FleetActionState> {
  const { supabase, organizationId } = await requireFleetManager();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const name = String(formData.get("name") ?? "").trim();
  const passengerCapacity = Number(formData.get("passengerCapacity"));
  const supportsCargo = formData.get("supportsCargo") === "on";
  const energyType = String(formData.get("energyType") ?? "");

  if (!name || !Number.isFinite(passengerCapacity) || passengerCapacity < 0 || passengerCapacity > 60) {
    return { status: "error", error: dict.errors.fleet.categoryNameAndCapacity };
  }
  if (!["ICE", "HEV", "PHEV", "BEV"].includes(energyType)) {
    return { status: "error", error: dict.errors.fleet.energyTypeRequired };
  }

  const { error } = await supabase.from("vehicle_categories").insert({
    organization_id: organizationId,
    name,
    passenger_capacity: passengerCapacity,
    supports_cargo: supportsCargo,
    energy_type: energyType as "ICE" | "HEV" | "PHEV" | "BEV",
  });
  if (error) return { status: "error", error: error.message };

  revalidatePath("/fleet");
  return { status: "success" };
}

export async function updateCategory(
  _prevState: FleetActionState,
  formData: FormData,
): Promise<FleetActionState> {
  const { supabase, organizationId } = await requireFleetManager();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const passengerCapacity = Number(formData.get("passengerCapacity"));
  const supportsCargo = formData.get("supportsCargo") === "on";
  const energyType = String(formData.get("energyType") ?? "");

  if (!id || !name || !Number.isFinite(passengerCapacity) || passengerCapacity < 0 || passengerCapacity > 60) {
    return { status: "error", error: dict.errors.fleet.categoryNameAndCapacity };
  }
  if (!["ICE", "HEV", "PHEV", "BEV"].includes(energyType)) {
    return { status: "error", error: dict.errors.fleet.energyTypeRequired };
  }

  const { error } = await supabase
    .from("vehicle_categories")
    .update({
      name,
      passenger_capacity: passengerCapacity,
      supports_cargo: supportsCargo,
      energy_type: energyType as "ICE" | "HEV" | "PHEV" | "BEV",
    })
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) return { status: "error", error: error.message };

  revalidatePath("/fleet");
  return { status: "success" };
}

export async function deleteCategory(
  _prevState: FleetActionState,
  formData: FormData,
): Promise<FleetActionState> {
  const { supabase, organizationId } = await requireFleetManager();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", error: dict.errors.fleet.categoryInvalid };

  const { error } = await supabase
    .from("vehicle_categories")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) {
    const inUse = error.code === "23503";
    return {
      status: "error",
      error: inUse ? dict.errors.fleet.categoryInUse : error.message,
    };
  }

  revalidatePath("/fleet");
  return { status: "success" };
}

export async function createVehicle(
  _prevState: FleetActionState,
  formData: FormData,
): Promise<FleetActionState> {
  const { supabase, organizationId } = await requireFleetManager();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const plate = String(formData.get("plate") ?? "").trim().toUpperCase();
  const categoryId = String(formData.get("categoryId") ?? "");
  const odometerKm = Number(formData.get("odometerKm"));
  const nextServiceOdometerKmRaw = formData.get("nextServiceOdometerKm");
  const nextServiceOdometerKm =
    nextServiceOdometerKmRaw && String(nextServiceOdometerKmRaw).length > 0
      ? Number(nextServiceOdometerKmRaw)
      : null;
  const estimatedRangeKm = Number(formData.get("estimatedRangeKm"));
  const locationId = String(formData.get("locationId") ?? "");
  const fuelLevelRaw = formData.get("fuelLevelPercent");
  const batteryLevelRaw = formData.get("batteryLevelPercent");
  const name = String(formData.get("name") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  const photo = formData.get("photo");

  if (!plate || !categoryId || !locationId) {
    return { status: "error", error: dict.errors.fleet.vehicleRequiredFields };
  }
  if (!Number.isFinite(odometerKm) || odometerKm < 0) {
    return { status: "error", error: dict.errors.fleet.odometerInvalid };
  }
  if (nextServiceOdometerKm !== null && (!Number.isFinite(nextServiceOdometerKm) || nextServiceOdometerKm < odometerKm)) {
    return { status: "error", error: dict.errors.fleet.nextServiceOdometerInvalid };
  }
  if (!Number.isFinite(estimatedRangeKm) || estimatedRangeKm < 0) {
    return { status: "error", error: dict.errors.fleet.estimatedRangeInvalid };
  }

  // Which of these two the vehicle's category actually shows (VehicleForm.tsx) already
  // gates which fields the form renders — energyType itself lives on the category, not
  // here, so whichever field the client never submitted just comes back null.
  const fuelLevelPercent = fuelLevelRaw ? Number(fuelLevelRaw) : null;
  const batteryLevelPercent = batteryLevelRaw ? Number(batteryLevelRaw) : null;

  // Mirrors the DB's `check (... between 0 and 100)` constraint (0001_init_schema.sql)
  // so an out-of-range or non-numeric value gets a friendly message here instead of a
  // raw Postgres constraint-violation string surfacing to the fleet manager.
  if (fuelLevelPercent !== null && (!Number.isFinite(fuelLevelPercent) || fuelLevelPercent < 0 || fuelLevelPercent > 100)) {
    return { status: "error", error: dict.errors.fleet.fuelLevelRange };
  }
  if (batteryLevelPercent !== null && (!Number.isFinite(batteryLevelPercent) || batteryLevelPercent < 0 || batteryLevelPercent > 100)) {
    return { status: "error", error: dict.errors.fleet.batteryLevelRange };
  }

  // category_id/location_id are plain FKs (0001_init_schema.sql) with no org-scoped
  // check — FK validation bypasses RLS, so without this the insert would silently
  // succeed with a category/location belonging to a different organization (same
  // cross-tenant-id risk already guarded against in 0006/0008's RPCs). Checked last
  // since it's the only validation that costs a DB round-trip.
  const [{ data: categoryRow }, { data: locationRow }] = await Promise.all([
    supabase.from("vehicle_categories").select("id").eq("id", categoryId).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("vehicle_locations").select("id").eq("id", locationId).eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (!categoryRow || !locationRow) {
    return { status: "error", error: dict.errors.fleet.categoryOrLocationInvalid };
  }

  const { data: inserted, error } = await supabase
    .from("vehicles")
    .insert({
      organization_id: organizationId,
      plate,
      category_id: categoryId,
      status: "available",
      odometer_km: odometerKm,
      next_service_odometer_km: nextServiceOdometerKm,
      estimated_range_km: estimatedRangeKm,
      fuel_level_percent: fuelLevelPercent,
      battery_level_percent: batteryLevelPercent,
      home_location_id: locationId,
      current_location_id: locationId,
      name,
      color,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    const friendlyError = error?.message.includes("duplicate") || error?.message.includes("unique")
      ? dict.errors.fleet.duplicatePlate
      : (error?.message ?? dict.errors.fleet.vehicleCreateFailed);
    return { status: "error", error: friendlyError };
  }

  // The photo path is keyed by vehicle id, so it can only be uploaded after the insert
  // returns one — a failure here shouldn't undo an otherwise-successful vehicle creation,
  // it just leaves the photo unset (the fleet manager can add it via Editar).
  if (photo instanceof File && photo.size > 0) {
    const uploadResult = await uploadVehiclePhoto(supabase, organizationId, inserted.id, photo, dict);
    if ("path" in uploadResult) {
      await supabase.from("vehicles").update({ photo_storage_path: uploadResult.path }).eq("id", inserted.id);
    }
  }

  revalidatePath("/fleet");
  revalidatePath("/dashboard");
  return { status: "success" };
}

/**
 * Edits a vehicle's reference/identity data (plate, category, energy type, maintenance
 * schedule, estimated range, fuel/battery reading, home base). Deliberately does NOT
 * touch `status` or `current_location_id`: those are operational state driven by the
 * pickup/return/block/unblock RPCs (0004/0006/0008_*.sql) and the dashboard's own
 * actions — letting a plain edit form overwrite them would let two different code paths
 * race to define "where is this vehicle / is it available" (see gauntlet §11 state
 * machine discipline). To take a vehicle out of rotation, use Bloquear on the dashboard.
 */
export async function updateVehicle(
  _prevState: FleetActionState,
  formData: FormData,
): Promise<FleetActionState> {
  const { supabase, organizationId } = await requireFleetManager();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", error: dict.errors.fleet.vehicleInvalid };

  const plate = String(formData.get("plate") ?? "").trim().toUpperCase();
  const categoryId = String(formData.get("categoryId") ?? "");
  const odometerKm = Number(formData.get("odometerKm"));
  const nextServiceOdometerKmRaw = formData.get("nextServiceOdometerKm");
  const nextServiceOdometerKm =
    nextServiceOdometerKmRaw && String(nextServiceOdometerKmRaw).length > 0
      ? Number(nextServiceOdometerKmRaw)
      : null;
  const estimatedRangeKm = Number(formData.get("estimatedRangeKm"));
  const homeLocationId = String(formData.get("locationId") ?? "");
  const fuelLevelRaw = formData.get("fuelLevelPercent");
  const batteryLevelRaw = formData.get("batteryLevelPercent");
  const name = String(formData.get("name") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  const photo = formData.get("photo");

  if (!plate || !categoryId || !homeLocationId) {
    return { status: "error", error: dict.errors.fleet.vehicleRequiredFields };
  }
  if (!Number.isFinite(odometerKm) || odometerKm < 0) {
    return { status: "error", error: dict.errors.fleet.odometerInvalid };
  }
  if (nextServiceOdometerKm !== null && (!Number.isFinite(nextServiceOdometerKm) || nextServiceOdometerKm < odometerKm)) {
    return { status: "error", error: dict.errors.fleet.nextServiceOdometerInvalid };
  }
  if (!Number.isFinite(estimatedRangeKm) || estimatedRangeKm < 0) {
    return { status: "error", error: dict.errors.fleet.estimatedRangeInvalid };
  }

  const fuelLevelPercent = fuelLevelRaw ? Number(fuelLevelRaw) : null;
  const batteryLevelPercent = batteryLevelRaw ? Number(batteryLevelRaw) : null;

  if (fuelLevelPercent !== null && (!Number.isFinite(fuelLevelPercent) || fuelLevelPercent < 0 || fuelLevelPercent > 100)) {
    return { status: "error", error: dict.errors.fleet.fuelLevelRange };
  }
  if (batteryLevelPercent !== null && (!Number.isFinite(batteryLevelPercent) || batteryLevelPercent < 0 || batteryLevelPercent > 100)) {
    return { status: "error", error: dict.errors.fleet.batteryLevelRange };
  }

  const [{ data: categoryRow }, { data: locationRow }] = await Promise.all([
    supabase.from("vehicle_categories").select("id").eq("id", categoryId).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("vehicle_locations").select("id").eq("id", homeLocationId).eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (!categoryRow || !locationRow) {
    return { status: "error", error: dict.errors.fleet.categoryOrLocationInvalid };
  }

  // Uploaded before the row update so a failed upload can report an error without
  // silently discarding the rest of the (already-validated) form on write.
  let photoStoragePath: string | undefined;
  if (photo instanceof File && photo.size > 0) {
    const uploadResult = await uploadVehiclePhoto(supabase, organizationId, id, photo, dict);
    if ("error" in uploadResult) return { status: "error", error: uploadResult.error };
    photoStoragePath = uploadResult.path;
  }

  const { error } = await supabase
    .from("vehicles")
    .update({
      plate,
      category_id: categoryId,
      odometer_km: odometerKm,
      next_service_odometer_km: nextServiceOdometerKm,
      estimated_range_km: estimatedRangeKm,
      fuel_level_percent: fuelLevelPercent,
      battery_level_percent: batteryLevelPercent,
      home_location_id: homeLocationId,
      name,
      color,
      ...(photoStoragePath ? { photo_storage_path: photoStoragePath } : {}),
    })
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) {
    const friendlyError = error.message.includes("duplicate") || error.message.includes("unique")
      ? dict.errors.fleet.duplicatePlate
      : error.message;
    return { status: "error", error: friendlyError };
  }

  revalidatePath("/fleet");
  revalidatePath("/dashboard");
  return { status: "success" };
}

export async function deleteVehicle(
  _prevState: FleetActionState,
  formData: FormData,
): Promise<FleetActionState> {
  const { supabase, organizationId } = await requireFleetManager();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", error: dict.errors.fleet.vehicleInvalid };

  const { error } = await supabase
    .from("vehicles")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) {
    // 23503: reservations/inspections/workflow_tasks reference this vehicle with no
    // cascade (0001/0002_*.sql) — by design, so operational history is never silently
    // lost. A vehicle that has actually been used can't be hard-deleted; "Bloquear" on
    // the dashboard (block_vehicle RPC, 0004_operational_actions.sql) is the correct way
    // to take it out of rotation without destroying its evidence trail.
    const hasHistory = error.code === "23503";
    return {
      status: "error",
      error: hasHistory ? dict.errors.fleet.vehicleHasHistory : error.message,
    };
  }

  revalidatePath("/fleet");
  revalidatePath("/dashboard");
  return { status: "success" };
}
