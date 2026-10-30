import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { FleetSummary } from "@/lib/trips/fleetSummary";
import { composeFailure, fleetExplanation, type AssistantReply } from "./replies";

/**
 * Assistant answer when the Mobility Decision Engine finds no vehicle for the requested window
 * (e.g. reasons ["no_candidates_available"] from packages/domain recommend.ts). That is a
 * LEGITIMATE business result, not a failure of the system. The reply says what happened, WHY from
 * the real fleet situation (counts per reason: reserved / in maintenance / blocked / in use / not
 * enough seats ...), the alternatives and that the trip data (and the carpool offer intention) go
 * pre-filled into /trips/new through the link. No reservation is created. Codes are never shown.
 */

/** A reason that looks like an internal code (snake_case) and has no translation is dropped. */
const CODE_LIKE = /^[a-z0-9_]+$/;

export function translateVehicleReasons(dict: Dictionary, reasons: readonly string[] | undefined): string[] {
  const map = dict.trips.reasons as Record<string, string>;
  const out: string[] = [];
  for (const raw of reasons ?? []) {
    const reason = String(raw ?? "").trim();
    if (!reason) continue;
    const text = map[reason] ?? (CODE_LIKE.test(reason) ? null : reason);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

export type NoVehicleReply = Required<AssistantReply>;

export function noVehicleReply(
  dict: Dictionary,
  slots: Record<string, string | undefined>,
  reasons: readonly string[] | undefined,
  fleet?: FleetSummary,
  action: "reservation" | "availability" = "reservation",
  /** Locations that have an eligible vehicle, offered when the origin is not a registered location. */
  originOptions?: readonly { name: string; count: number }[],
): NoVehicleReply {
  if (originOptions?.length && reasons?.includes("origin_location_unknown")) {
    const list = originOptions.map((o) => `• ${o.name} (${o.count})`).join("\n");
    return composeFailure(dict, action, dict.chat.replies.originPick.replace("{list}", list), { mode: "form", slots }) as NoVehicleReply;
  }
  // The person leaves from their own location and no vehicle is there: say only that (never offer another location's vehicle as if it
  // were theirs): no list of other locations, no alternatives, no form link. Just who to ask.
  if (reasons?.includes("no_vehicles_at_origin")) {
    const origin = (slots.origin ?? "").trim();
    if (origin) {
      // no link on purpose (the consumers accept a reply without one)
      return { content: dict.chat.replies.originNone.replace("{origin}", origin) } as NoVehicleReply;
    }
  }
  // Real cause from the fleet counts; without them, the engine's own (translated) reason.
  const why = fleet
    ? fleetExplanation(dict, fleet, action === "reservation")
    : translateVehicleReasons(dict, reasons).join(" ") || dict.chat.replies.fleet.intro;
  return composeFailure(dict, action, why, { mode: "form", slots }) as NoVehicleReply;
}
