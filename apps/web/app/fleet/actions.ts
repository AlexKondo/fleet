"use server";
import { uploadImmutablePhoto } from "@/lib/domain/immutablePhoto";

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

/** Private immutable reference photo: journal before upload, content-addressed path,
 * no overwrite/delete, atomic link finalization. Failed links remain recoverable. */
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
  try { return await uploadImmutablePhoto(supabase,"vehicle",vehicleId,null,file); }
  catch { return {error:dict.errors.fleet.photoUploadFailed}; }
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

async function lifecycleAction(kind:string,formData:FormData):Promise<FleetActionState>{
 const {supabase,organizationId}=await requireFleetManager();if(!organizationId)return{status:"error",error:"not_authorized"};
 const id=String(formData.get("id")??"");const version=Number(formData.get("lifecycleVersion")??1);
 if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(version)||version<1)return{status:"error",error:"Confira o registro e recarregue a página."};
 const {error}=await supabase.rpc("fm_fleet_lifecycle",{p_kind:kind,p_id:id,p_enabled:false,p_version:version,p_reason:String(formData.get("archiveReason")??"").trim()||"Desativação solicitada pela gestão de frota",p_request_id:crypto.randomUUID()});
 if(error)return{status:"error",error:({ACTIVE_OPERATION:"Há reserva, chaves ou manutenção em andamento. Regularize a operação antes de arquivar.",ACTIVE_REFERENCE:"Este cadastro ainda está vinculado a veículo ativo.",CONCURRENT_UPDATE:"O registro mudou. Recarregue e confira o estado atual.",NOT_AUTHORIZED:"Seu acesso não permite esta alteração."} as Record<string,string>)[error.message]??"Não foi possível alterar o estado do registro."};
 revalidatePath("/fleet","layout");revalidatePath("/dashboard","layout");return{status:"success"};
}
export async function deleteLocation(_prevState:FleetActionState,formData:FormData):Promise<FleetActionState>{return lifecycleAction("location",formData);}

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

export async function deleteCategory(_prevState:FleetActionState,formData:FormData):Promise<FleetActionState>{return lifecycleAction("category",formData);}

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

  const { data: createdId, error } = await supabase.rpc("fm_management_create_vehicle", {
    p_unit_id: String(formData.get("unitId") ?? "").trim() || null,
    p_values: {
      plate, category_id: categoryId, odometer_km: odometerKm,
      next_service_odometer_km: nextServiceOdometerKm, estimated_range_km: estimatedRangeKm,
      fuel_level_percent: fuelLevelPercent, battery_level_percent: batteryLevelPercent,
      home_location_id: locationId, name, color,
    },
  });
  const inserted = createdId ? {id: createdId} : null;
  if (error || !inserted) {
    const friendlyError = error?.message.includes("duplicate") || error?.message.includes("unique")
      ? dict.errors.fleet.duplicatePlate
      : error?.message === "MANAGEMENT_SCOPE_DENIED" ? "Selecione uma unidade-base autorizada para sua gestão." : dict.errors.fleet.vehicleCreateFailed;
    return { status: "error", error: friendlyError };
  }

  // The photo path is keyed by vehicle id, so it can only be uploaded after the insert
  // returns one — a failure here shouldn't undo an otherwise-successful vehicle creation,
  // it just leaves the photo unset (the fleet manager can add it via Editar).
  if (photo instanceof File && photo.size > 0) {
    const uploadResult = await uploadVehiclePhoto(supabase, organizationId, inserted.id, photo, dict);
    if ("error" in uploadResult) {
      revalidatePath("/fleet");
      return {status:"error",error:"Veículo criado. A foto não foi concluída; use Editar neste veículo para tentar novamente, sem repetir o cadastro."};
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
  
  if (photo instanceof File && photo.size > 0) {
    const uploadResult = await uploadVehiclePhoto(supabase, organizationId, id, photo, dict);
    if ("error" in uploadResult) return { status: "error", error: uploadResult.error };

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

export async function deleteVehicle(_prevState:FleetActionState,formData:FormData):Promise<FleetActionState>{return lifecycleAction("vehicle",formData);}
