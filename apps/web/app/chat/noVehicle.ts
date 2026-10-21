import type { Dictionary } from "@/lib/i18n/dictionaries";
import { buildTripPrefillHref } from "@/lib/trips/tripPrefill";

/**
 * Assistant answer when the Mobility Decision Engine finds no vehicle for the requested window
 * (e.g. reasons ["no_candidates_available"] from packages/domain recommend.ts). That is a
 * LEGITIMATE business result, not a failure: the user gets the translated reason, the
 * alternatives, an explicit "your carpool offer was not lost" note when they wanted to offer
 * seats, and a link that opens /trips/new with the trip data already filled in. No reservation
 * is created. Engine reason codes are never shown raw.
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

export interface NoVehicleReply {
  content: string;
  link: { href: string; label: string };
}

export function noVehicleReply(
  dict: Dictionary,
  slots: Record<string, string | undefined>,
  reasons: readonly string[] | undefined,
): NoVehicleReply {
  const t = dict.chat.noVehicle;
  const explained = translateVehicleReasons(dict, reasons);
  const lines = [
    `${explained.length > 0 ? explained.join(" ") : t.intro} ${t.alternatives}`,
  ];
  if (slots.allowCarpool === "true") lines.push(t.carpoolKept);
  return {
    content: lines.join("\n"),
    link: { href: buildTripPrefillHref(slots), label: t.openForm },
  };
}
