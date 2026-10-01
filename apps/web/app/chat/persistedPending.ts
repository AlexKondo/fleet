/**
 * Phase C6 follow-up (F1): numbered options (carpool offers, "Usar um veículo") must survive a
 * page reload. They are persisted INSIDE the assistant chat_messages row's `slots` jsonb under a
 * reserved key and stripped again on read, so the slots that reach dispatch / the confirm guard
 * never contain it. Restored ids are only HINTS (fresh searches re-validate them at card and at
 * confirm time), but the shape is still validated here.
 */
import { isUuid } from "@/lib/carpool/rpcErrors";

export const OPTIONS_SLOT_KEY = "__options";
export const VEHICLE_OPTION_ID = "__vehicle__";

export interface PersistedOption {
  id: string;
  label: string;
}

export function packSlots(
  slots: Record<string, string> | undefined,
  options?: PersistedOption[],
): Record<string, string> | undefined {
  if (!slots) return undefined;
  if (!options || options.length === 0) return slots;
  return { ...slots, [OPTIONS_SLOT_KEY]: JSON.stringify(options) };
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

/** Splits a persisted slots object into the clean slots and the (validated) options. */
export function unpackSlots(raw: unknown): { slots: Record<string, string>; options?: PersistedOption[] } {
  const slots: Record<string, string> = {};
  let options: PersistedOption[] | undefined;
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (k === OPTIONS_SLOT_KEY) options = parseOptions(v);
    else if (typeof v === "string") slots[k] = v;
  }
  return { slots, options };
}
