/**
 * Phase C6 follow-up (F1): numbered options (carpool offers, "Usar um veículo") must survive a
 * page reload. They are persisted INSIDE the assistant chat_messages row's `slots` jsonb under a
 * reserved key and stripped again on read, so the slots that reach dispatch / the confirm guard
 * never contain it. Restored ids are only HINTS (fresh searches re-validate them at card and at
 * confirm time), but the shape is still validated here.
 */
import { isUuid } from "@/lib/carpool/rpcErrors";

export const OPTIONS_SLOT_KEY = "__options";
export const VEHICLE_OPTIONS_SLOT_KEY = "__vehicle_options";
export const VEHICLE_OPTION_ID = "__vehicle__";

export interface PersistedOption {
  id: string;
  label: string;
}

export interface PersistedVehicleOption {
  vehicleId: string;
  plate: string;
  vehicleName: string;
}

/**
 * C7b hardening: every key starting with "__" is RESERVED for this module's own persisted metadata. Slots come
 * from the LLM (and, echoed back, from the client): neither may ever smuggle a reserved key into what gets
 * persisted (an LLM-emitted "__options" slot would otherwise be restored as numbered options after a reload).
 * Applied at ingestion (chat/actions.ts, right after the interpreter) AND at persistence (packSlots).
 */
export function stripReservedSlots<T extends Record<string, string> | undefined>(slots: T): T {
  if (!slots) return slots;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(slots)) {
    if (!k.startsWith("__")) clean[k] = v;
  }
  return clean as T;
}

export function packSlots(
  slots: Record<string, string> | undefined,
  options?: PersistedOption[],
  vehicleOptions?: PersistedVehicleOption[],
): Record<string, string> | undefined {
  if (!slots) return undefined;
  const packed: Record<string, string> = stripReservedSlots(slots);
  if (options && options.length > 0) packed[OPTIONS_SLOT_KEY] = JSON.stringify(options);
  if (vehicleOptions && vehicleOptions.length > 0) packed[VEHICLE_OPTIONS_SLOT_KEY] = JSON.stringify(vehicleOptions);
  return packed;
}

export function parseOptions(raw: unknown): PersistedOption[] | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20) return undefined;
    const out: PersistedOption[] = [];
    for (const o of parsed) {
      const id = (o as { id?: unknown })?.id;
      const label = (o as { label?: unknown })?.label;
      if (typeof id !== "string" || typeof label !== "string") return undefined;
      if (!isUuid(id) && id !== VEHICLE_OPTION_ID) return undefined;
      out.push({ id, label: label.slice(0, 300) });
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Validates the persisted vehicle alternatives (the CREATE_RESERVATION card's numbered buttons). Restored ids
 * are only HINTS - choosing one re-runs the recommendation server-side (chat/actions.ts select_vehicle) - but
 * the shape is still strictly validated: uuid ids, short printable plate / name, at most 10 entries.
 */
export function parseVehicleOptions(raw: unknown): PersistedVehicleOption[] | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > 10) return undefined;
    const out: PersistedVehicleOption[] = [];
    for (const o of parsed) {
      const vehicleId = (o as { vehicleId?: unknown })?.vehicleId;
      const plate = (o as { plate?: unknown })?.plate;
      const vehicleName = (o as { vehicleName?: unknown })?.vehicleName;
      if (typeof vehicleId !== "string" || !isUuid(vehicleId)) return undefined;
      if (typeof plate !== "string" || !/^[A-Za-z0-9-]{1,12}$/.test(plate)) return undefined;
      if (typeof vehicleName !== "string" || vehicleName.length > 80 || /[<>]/.test(vehicleName)) return undefined;
      out.push({ vehicleId, plate, vehicleName });
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Splits a persisted slots object into the clean slots and the (validated) options. */
export function unpackSlots(raw: unknown): {
  slots: Record<string, string>;
  options?: PersistedOption[];
  vehicleOptions?: PersistedVehicleOption[];
} {
  const slots: Record<string, string> = {};
  let options: PersistedOption[] | undefined;
  let vehicleOptions: PersistedVehicleOption[] | undefined;
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (k === OPTIONS_SLOT_KEY) options = parseOptions(v);
    else if (k === VEHICLE_OPTIONS_SLOT_KEY) vehicleOptions = parseVehicleOptions(v);
    else if (k.startsWith("__")) continue; // any other reserved key never becomes a slot
    else if (typeof v === "string") slots[k] = v;
  }
  return { slots, options, vehicleOptions };
}
