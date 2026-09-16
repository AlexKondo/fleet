import type { Database } from "@fleet/supabase-client";
import type { Dictionary } from "../../lib/i18n/dictionaries";

type VehicleStatus = Database["public"]["Enums"]["vehicle_status"];

export type StatusMeta = { label: string; dot: string; text: string };

/** Colors only — the label comes from the active dictionary (dict.status.vehicle). */
const STATUS_COLORS: Record<VehicleStatus, { dot: string; text: string }> = {
  available: { dot: "bg-signal-green", text: "text-signal-green" },
  reserved: { dot: "bg-signal-blue", text: "text-signal-blue" },
  awaiting_pickup: { dot: "bg-signal-blue", text: "text-signal-blue" },
  in_use: { dot: "bg-signal-blue", text: "text-signal-blue" },
  returning: { dot: "bg-signal-violet", text: "text-signal-violet" },
  inspection: { dot: "bg-signal-yellow", text: "text-signal-yellow" },
  charging: { dot: "bg-signal-teal", text: "text-signal-teal" },
  cleaning: { dot: "bg-signal-yellow", text: "text-signal-yellow" },
  maintenance: { dot: "bg-signal-red", text: "text-signal-red" },
  blocked: { dot: "bg-signal-red", text: "text-signal-red" },
};

export const VEHICLE_STATUSES = Object.keys(STATUS_COLORS) as VehicleStatus[];

/** Builds the localized status → {label, dot, text} map for the active locale. */
export function getStatusMeta(dict: Dictionary): Record<VehicleStatus, StatusMeta> {
  const out = {} as Record<VehicleStatus, StatusMeta>;
  for (const key of VEHICLE_STATUSES) {
    out[key] = { ...STATUS_COLORS[key], label: dict.status.vehicle[key] };
  }
  return out;
}

/** Localized attention-reason labels, keyed by reason code. */
export function getAttentionLabels(dict: Dictionary): Record<string, string> {
  return { ...dict.status.attention };
}
