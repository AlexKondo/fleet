import type { Dictionary } from "@/lib/i18n/dictionaries";
import { fillTemplate } from "@/lib/carpool/errorText";
import { buildTripPrefillHref } from "@/lib/trips/tripPrefill";
import type { FleetSummary } from "@/lib/trips/fleetSummary";

/**
 * FIX-VENCIDAS / Assistente — "padrão de linguagem simples".
 *
 * Every failure the assistant reports is composed from four parts, all from the dictionaries
 * (chat.replies.*), so the user always reads, in plain words and in their language:
 *   1. what happened          (replies.what[action])
 *   2. why, when it is safely known (replies.why[kind] or an already-translated business reason)
 *   3. what they can do       (replies.alternatives[action])
 *   4. how to continue without losing what they said
 *        - "form":    the trip data really goes into a /trips/new link (keptInForm + link)
 *        - "chat":    the conversation (history) is still there (keptInChat)
 *        - "reenter": nothing was kept; they need to ask again (reenter)
 * Codes, RPC/function names, database messages and stack traces never reach this text: raw causes
 * go to the server log only (console.error at the call sites).
 */

export type ReplyAction = keyof Dictionary["chat"]["replies"]["what"];
export type FailureKind = keyof Dictionary["chat"]["replies"]["why"];
export interface AssistantReply {
  content: string;
  link?: { href: string; label: string };
}
export type ContinueMode =
  | { mode: "form"; slots: Record<string, string | undefined> }
  | { mode: "chat" }
  | { mode: "reenter" };

export function composeFailure(
  dict: Dictionary,
  action: ReplyAction,
  why: string | null | undefined,
  cont: ContinueMode,
): AssistantReply {
  const r = dict.chat.replies;
  const parts = [r.what[action], why?.trim() || null, r.alternatives[action]];
  let link: AssistantReply["link"];
  if (cont.mode === "form") {
    if (cont.slots.allowCarpool === "true") parts.push(dict.chat.noVehicle.carpoolKept);
    parts.push(r.keptInForm);
    link = { href: buildTripPrefillHref(cont.slots), label: dict.chat.noVehicle.openForm };
  } else {
    parts.push(cont.mode === "chat" ? r.keptInChat : r.reenter);
  }
  const content = parts.filter((p): p is string => Boolean(p)).join(" ");
  return link ? { content, link } : { content };
}

export function failureReply(
  dict: Dictionary,
  action: ReplyAction,
  kind: FailureKind,
  cont: ContinueMode,
): AssistantReply {
  return composeFailure(dict, action, dict.chat.replies.why[kind], cont);
}

/** Known error codes / database messages -> a business reason. Anything else is "unexpected". */
const RULES: [RegExp, FailureKind][] = [
  [/^23P01$|RESERVATION_CONFLICT|reservations_vehicle_id_tstzrange_excl|conflicting key value/i, "reservationConflict"],
  [/MAINTENANCE_CONFLICT/, "maintenanceConflict"],
  [/VEHICLE_ARCHIVED|VEHICLE_NOT_AVAILABLE|^NOT_FOUND$/, "vehicleUnavailable"],
  [/UNIT_DISABLED/, "unitDisabled"],
  [/DRIVER_NOT_AUTHORIZED|LICENSE_|DRIVER_LICENSE|CNH/, "license"],
  [/OUTSIDE_RESERVATION_WINDOW|PICKUP_WINDOW_/, "outsideWindow"],
  [/MANAGEMENT_SCOPE_DENIED/, "scopeDenied"],
  [/^42501$|permission denied|not authorized|NOT_AUTHORIZED|INSUFFICIENT_PRIVILEGE/i, "permissionDenied"],
  [/CANCEL_BLOCKED_OPERATION_STARTED|already underway|RESERVATION_HAS_OPERATIONS/i, "tripStarted"],
  [/Cannot cancel a reservation with status|INVALID_STATE_TRANSITION/i, "cancelNotAllowed"],
  [/CONCURRENT_UPDATE|modified concurrently/i, "concurrent"],
  [/^(23514|22007|22008|22P02|23502)$|reservations_check|invalid input|INVALID_INPUT|out of range/i, "invalidData"],
  [/^reservation_not_found$|Reservation not found|RESERVATION_NOT_FOUND/i, "notFound"],
  [/^not_authenticated$|JWT|session/i, "sessionExpired"],
  [/^missing_new_return_time$/, "missingReturnTime"],
  [/^not_supported_via_chat$/, "notSupported"],
  [/^incomplete_slots$/, "missingInfo"],
  [/^rate_limited$/, "rateLimited"],
  [/^daily_limit_reached$/, "dailyLimit"],
];

export function classifyError(...signals: (string | null | undefined)[]): FailureKind {
  for (const signal of signals) {
    if (!signal) continue;
    for (const [re, kind] of RULES) if (re.test(signal)) return kind;
  }
  return "unexpected";
}

/** "No vehicle for that window", from the REAL cause: counts per blocking reason, never anyone's trip. */
const FLEET_ORDER = ["reserved", "maintenance", "blocked", "inUse", "busy", "seats", "cargo", "notReady", "other"] as const;

export function fleetExplanation(dict: Dictionary, fleet: FleetSummary | undefined, withIntro: boolean): string {
  const f = dict.chat.replies.fleet;
  const intro = withIntro ? `${f.intro} ` : "";
  if (!fleet) return withIntro ? f.intro : "";
  if (fleet.total === 0) return `${intro}${f.empty}`;
  const parts = FLEET_ORDER.filter((k) => fleet[k] > 0).map((k) =>
    fillTemplate(fleet[k] === 1 ? f[`${k}One`] : f[`${k}Other`], { count: fleet[k] }),
  );
  if (parts.length === 0) return withIntro ? f.intro : "";
  const and = dict.chat.replies.and;
  const sep = and.trim() === "和" ? "、" : ", ";
  const joined = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(sep)}${and}${parts.at(-1)}`;
  return `${intro}${fillTemplate(f.summary, { total: fleet.total, parts: joined })}`;
}
