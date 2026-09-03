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
