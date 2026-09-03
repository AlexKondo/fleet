"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface FleetActionState {
  status: "idle" | "success" | "error";
  error?: string;
}

async function requireFleetManager() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { status: "error", error: "Informe um nome para a localização." };

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

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { status: "error", error: "Informe um nome para a localização." };

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

  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", error: "Localização inválida." };

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
      error: inUse
        ? "Não é possível excluir: existem veículos usando esta localização."
        : error.message,
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

  const name = String(formData.get("name") ?? "").trim();
  const passengerCapacity = Number(formData.get("passengerCapacity"));
  const supportsCargo = formData.get("supportsCargo") === "on";

  if (!name || !Number.isFinite(passengerCapacity) || passengerCapacity < 0 || passengerCapacity > 60) {
    return { status: "error", error: "Preencha o nome e uma capacidade de passageiros válida (0-60)." };
  }

  const { error } = await supabase.from("vehicle_categories").insert({
    organization_id: organizationId,
    name,
    passenger_capacity: passengerCapacity,
    supports_cargo: supportsCargo,
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

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const passengerCapacity = Number(formData.get("passengerCapacity"));
  const supportsCargo = formData.get("supportsCargo") === "on";

  if (!id || !name || !Number.isFinite(passengerCapacity) || passengerCapacity < 0 || passengerCapacity > 60) {
    return { status: "error", error: "Preencha o nome e uma capacidade de passageiros válida (0-60)." };
  }

  const { error } = await supabase
    .from("vehicle_categories")
    .update({ name, passenger_capacity: passengerCapacity, supports_cargo: supportsCargo })
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

  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", error: "Categoria inválida." };

  const { error } = await supabase
    .from("vehicle_categories")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) {
    const inUse = error.code === "23503";
    return {
      status: "error",
      error: inUse
        ? "Não é possível excluir: existem veículos cadastrados nesta categoria."
        : error.message,
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

  const plate = String(formData.get("plate") ?? "").trim().toUpperCase();
  const categoryId = String(formData.get("categoryId") ?? "");
  const energyType = String(formData.get("energyType") ?? "");
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

  if (!plate || !categoryId || !locationId) {
    return { status: "error", error: "Preencha placa, categoria e localização." };
  }
  if (!["ICE", "PHEV", "BEV"].includes(energyType)) {
    return { status: "error", error: "Selecione o tipo de energia do veículo." };
  }
  if (!Number.isFinite(odometerKm) || odometerKm < 0) {
    return { status: "error", error: "Quilometragem inválida." };
  }
  if (nextServiceOdometerKm !== null && (!Number.isFinite(nextServiceOdometerKm) || nextServiceOdometerKm < odometerKm)) {
    return { status: "error", error: "A quilometragem da próxima revisão deve ser maior que a atual." };
  }
  if (!Number.isFinite(estimatedRangeKm) || estimatedRangeKm < 0) {
    return { status: "error", error: "Autonomia estimada inválida." };
  }

  const showFuel = energyType === "ICE" || energyType === "PHEV";
  const showBattery = energyType === "BEV" || energyType === "PHEV";
  const fuelLevelPercent = showFuel && fuelLevelRaw ? Number(fuelLevelRaw) : null;
  const batteryLevelPercent = showBattery && batteryLevelRaw ? Number(batteryLevelRaw) : null;

  // Mirrors the DB's `check (... between 0 and 100)` constraint (0001_init_schema.sql)
  // so an out-of-range or non-numeric value gets a friendly message here instead of a
  // raw Postgres constraint-violation string surfacing to the fleet manager.
  if (fuelLevelPercent !== null && (!Number.isFinite(fuelLevelPercent) || fuelLevelPercent < 0 || fuelLevelPercent > 100)) {
    return { status: "error", error: "O nível de combustível deve estar entre 0 e 100%." };
  }
  if (batteryLevelPercent !== null && (!Number.isFinite(batteryLevelPercent) || batteryLevelPercent < 0 || batteryLevelPercent > 100)) {
    return { status: "error", error: "O nível de bateria deve estar entre 0 e 100%." };
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
    return { status: "error", error: "Categoria ou localização inválida." };
  }

  const { error } = await supabase.from("vehicles").insert({
    organization_id: organizationId,
    plate,
    category_id: categoryId,
    energy_type: energyType as "ICE" | "PHEV" | "BEV",
    status: "available",
    odometer_km: odometerKm,
    next_service_odometer_km: nextServiceOdometerKm,
    estimated_range_km: estimatedRangeKm,
    fuel_level_percent: fuelLevelPercent,
    battery_level_percent: batteryLevelPercent,
    home_location_id: locationId,
    current_location_id: locationId,
  });
  if (error) {
    const friendlyError = error.message.includes("duplicate") || error.message.includes("unique")
      ? "Já existe um veículo com essa placa nesta organização."
      : error.message;
    return { status: "error", error: friendlyError };
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

  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", error: "Veículo inválido." };

  const plate = String(formData.get("plate") ?? "").trim().toUpperCase();
  const categoryId = String(formData.get("categoryId") ?? "");
  const energyType = String(formData.get("energyType") ?? "");
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

  if (!plate || !categoryId || !homeLocationId) {
    return { status: "error", error: "Preencha placa, categoria e localização." };
  }
  if (!["ICE", "PHEV", "BEV"].includes(energyType)) {
    return { status: "error", error: "Selecione o tipo de energia do veículo." };
  }
  if (!Number.isFinite(odometerKm) || odometerKm < 0) {
    return { status: "error", error: "Quilometragem inválida." };
  }
  if (nextServiceOdometerKm !== null && (!Number.isFinite(nextServiceOdometerKm) || nextServiceOdometerKm < odometerKm)) {
    return { status: "error", error: "A quilometragem da próxima revisão deve ser maior que a atual." };
  }
  if (!Number.isFinite(estimatedRangeKm) || estimatedRangeKm < 0) {
    return { status: "error", error: "Autonomia estimada inválida." };
  }

  const showFuel = energyType === "ICE" || energyType === "PHEV";
  const showBattery = energyType === "BEV" || energyType === "PHEV";
  const fuelLevelPercent = showFuel && fuelLevelRaw ? Number(fuelLevelRaw) : null;
  const batteryLevelPercent = showBattery && batteryLevelRaw ? Number(batteryLevelRaw) : null;

  if (fuelLevelPercent !== null && (!Number.isFinite(fuelLevelPercent) || fuelLevelPercent < 0 || fuelLevelPercent > 100)) {
    return { status: "error", error: "O nível de combustível deve estar entre 0 e 100%." };
  }
  if (batteryLevelPercent !== null && (!Number.isFinite(batteryLevelPercent) || batteryLevelPercent < 0 || batteryLevelPercent > 100)) {
    return { status: "error", error: "O nível de bateria deve estar entre 0 e 100%." };
  }

  const [{ data: categoryRow }, { data: locationRow }] = await Promise.all([
    supabase.from("vehicle_categories").select("id").eq("id", categoryId).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("vehicle_locations").select("id").eq("id", homeLocationId).eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (!categoryRow || !locationRow) {
    return { status: "error", error: "Categoria ou localização inválida." };
  }

  const { error } = await supabase
    .from("vehicles")
    .update({
      plate,
      category_id: categoryId,
      energy_type: energyType as "ICE" | "PHEV" | "BEV",
      odometer_km: odometerKm,
      next_service_odometer_km: nextServiceOdometerKm,
      estimated_range_km: estimatedRangeKm,
      fuel_level_percent: fuelLevelPercent,
      battery_level_percent: batteryLevelPercent,
      home_location_id: homeLocationId,
    })
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) {
    const friendlyError = error.message.includes("duplicate") || error.message.includes("unique")
      ? "Já existe um veículo com essa placa nesta organização."
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

  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", error: "Veículo inválido." };

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
      error: hasHistory
        ? 'Não é possível excluir: este veículo já tem reservas ou inspeções registradas. Use "Bloquear" no Painel para retirá-lo de operação sem perder o histórico.'
        : error.message,
    };
  }

  revalidatePath("/fleet");
  revalidatePath("/dashboard");
  return { status: "success" };
}
