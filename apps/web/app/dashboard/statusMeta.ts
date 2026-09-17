import type { Database } from "@fleet/supabase-client";
import type { Dictionary } from "../../lib/i18n/dictionaries";

type VehicleStatus = Database["public"]["Enums"]["vehicle_status"];

/**
 * Icon key per status — the SECOND visual dimension next to color. Ten statuses share
 * six hues (three blues, two yellows, two reds), so color alone can't tell
 * reserved/awaiting_pickup/in_use, inspection/cleaning or maintenance/blocked apart at a
 * glance. The hue mapping below is a closed, documented exception to the 3-color brand
 * palette (globals.css) and must not change; the glyph is what disambiguates.
 * Rendered by app/ui/StatusBadge.tsx.
 */
export type StatusIconKey =
  | "check"
  | "bookmark"
  | "key"
  | "steering"
  | "uturn"
  | "magnifier"
  | "bolt"
  | "droplet"
  | "wrench"
  | "ban";

/**
 * `icon` was added alongside the pre-existing `dot`/`text` fields rather than replacing
 * them, so every existing inline badge (dashboard/page.tsx, reservations/[id]/page.tsx)
 * keeps working untouched.
 */
export type StatusMeta = { label: string; dot: string; text: string; icon: StatusIconKey };

/** Colors + glyph only — the label comes from the active dictionary (dict.status.vehicle). */
const STATUS_COLORS: Record<VehicleStatus, { dot: string; text: string; icon: StatusIconKey }> = {
  available: { dot: "bg-signal-green", text: "text-signal-green", icon: "check" },
  reserved: { dot: "bg-signal-blue", text: "text-signal-blue", icon: "bookmark" },
  awaiting_pickup: { dot: "bg-signal-blue", text: "text-signal-blue", icon: "key" },
  in_use: { dot: "bg-signal-blue", text: "text-signal-blue", icon: "steering" },
  returning: { dot: "bg-signal-violet", text: "text-signal-violet", icon: "uturn" },
  inspection: { dot: "bg-signal-yellow", text: "text-signal-yellow", icon: "magnifier" },
  charging: { dot: "bg-signal-teal", text: "text-signal-teal", icon: "bolt" },
  cleaning: { dot: "bg-signal-yellow", text: "text-signal-yellow", icon: "droplet" },
  maintenance: { dot: "bg-signal-red", text: "text-signal-red", icon: "wrench" },
  blocked: { dot: "bg-signal-red", text: "text-signal-red", icon: "ban" },
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
