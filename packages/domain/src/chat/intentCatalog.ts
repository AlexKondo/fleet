/**
 * Intent Catalog Release 1 (Voice & Conversational UX pack, §7). Pure data + pure lookup
 * functions — no I/O, no LLM calls, mirroring how every other packages/domain module works
 * (mobility-engine, reservation). The conversational orchestrator (apps/web) asks the LLM
 * to classify a message into one of these names; this module is the single source of truth
 * for which slots each intent needs and whether it requires an explicit user confirmation
 * before anything gets dispatched to a real (RBAC-enforced) action.
 */
export const INTENT_NAMES = [
  "CREATE_RESERVATION",
  "VIEW_RESERVATION",
  "CHANGE_RESERVATION",
  "EXTEND_RESERVATION",
  "CANCEL_RESERVATION",
  "FIND_MY_VEHICLE",
  "CHECK_AVAILABILITY",
  "CHECK_RANGE",
  "REQUEST_DIFFERENT_VEHICLE",
  "REPORT_DAMAGE",
  "REPORT_DELAY",
  "START_TRIP",
  "END_TRIP",
  "ASK_FLEET",
  // Smart Carpool (Phase C6). Every mutating one requires an explicit confirmation and an
  // anchor slot; none of them is ever executed by the LLM (dispatch.ts calls the same server
  // services/RPCs the web UI uses).
  "OFFER_CARPOOL",
  "DISABLE_CARPOOL",
  "FIND_CARPOOL",
  "REQUEST_CARPOOL",
  "ACCEPT_CARPOOL_REQUEST",
  "REJECT_CARPOOL_REQUEST",
  "CANCEL_CARPOOL_REQUEST",
] as const;

export type IntentName = (typeof INTENT_NAMES)[number];

export type ConfirmationRequirement = "yes" | "potentially" | "no";

interface IntentDefinition {
  requiresConfirmation: ConfirmationRequirement;
  /** Slot keys (see slots.ts) that must be present before this intent can be dispatched. */
  requiredSlots: string[];
}

const INTENT_CATALOG: Record<IntentName, IntentDefinition> = {
  CREATE_RESERVATION: {
    requiresConfirmation: "yes",
    requiredSlots: ["departureAt", "expectedReturnAt", "destination", "allowCarpool"],
  },
  VIEW_RESERVATION: { requiresConfirmation: "no", requiredSlots: [] },
  CHANGE_RESERVATION: { requiresConfirmation: "yes", requiredSlots: ["reservationId"] },
  EXTEND_RESERVATION: {
    requiresConfirmation: "yes",
    requiredSlots: ["reservationId", "newExpectedReturnAt"],
  },
  CANCEL_RESERVATION: { requiresConfirmation: "yes", requiredSlots: ["reservationId"] },
  FIND_MY_VEHICLE: { requiresConfirmation: "no", requiredSlots: [] },
  CHECK_AVAILABILITY: {
    requiresConfirmation: "no",
    requiredSlots: ["departureAt", "expectedReturnAt"],
  },
  CHECK_RANGE: { requiresConfirmation: "no", requiredSlots: ["destination"] },
  REQUEST_DIFFERENT_VEHICLE: {
    requiresConfirmation: "potentially",
    requiredSlots: ["reservationId"],
  },
  REPORT_DAMAGE: { requiresConfirmation: "yes", requiredSlots: ["reservationId", "damageNotes"] },
  REPORT_DELAY: { requiresConfirmation: "yes", requiredSlots: ["reservationId"] },
  START_TRIP: { requiresConfirmation: "yes", requiredSlots: ["reservationId"] },
  END_TRIP: { requiresConfirmation: "yes", requiredSlots: ["reservationId"] },
  ASK_FLEET: { requiresConfirmation: "no", requiredSlots: [] },
  // Carpool. `seats` comes from the user's words; `offerId` / `requestId` are NEVER produced by
  // the LLM: the server resolves them from the caller's OWN data (ownership-scoped) before the
  // confirmation card is built and re-validates them again at confirm time.
  OFFER_CARPOOL: { requiresConfirmation: "yes", requiredSlots: ["seats"] },
  DISABLE_CARPOOL: { requiresConfirmation: "yes", requiredSlots: ["offerId"] },
  // Read-only search: nothing is created, so no confirmation card (the follow-up REQUEST is).
  FIND_CARPOOL: { requiresConfirmation: "no", requiredSlots: ["destination", "departureAt"] },
  REQUEST_CARPOOL: { requiresConfirmation: "yes", requiredSlots: ["offerId"] },
  ACCEPT_CARPOOL_REQUEST: { requiresConfirmation: "yes", requiredSlots: ["requestId"] },
  REJECT_CARPOOL_REQUEST: { requiresConfirmation: "yes", requiredSlots: ["requestId"] },
  CANCEL_CARPOOL_REQUEST: { requiresConfirmation: "yes", requiredSlots: ["requestId"] },
};

/** The carpool intents (Phase C6) - handled by apps/web/app/chat/carpoolChat.ts. */
export const CARPOOL_INTENT_NAMES = [
  "OFFER_CARPOOL",
  "DISABLE_CARPOOL",
  "FIND_CARPOOL",
  "REQUEST_CARPOOL",
  "ACCEPT_CARPOOL_REQUEST",
  "REJECT_CARPOOL_REQUEST",
  "CANCEL_CARPOOL_REQUEST",
] as const satisfies readonly IntentName[];

export function isCarpoolIntent(intent: IntentName): boolean {
  return (CARPOOL_INTENT_NAMES as readonly string[]).includes(intent);
}

export function isIntentKnown(name: string): name is IntentName {
  return (INTENT_NAMES as readonly string[]).includes(name);
}

export function requiresConfirmation(intent: IntentName): ConfirmationRequirement {
  return INTENT_CATALOG[intent].requiresConfirmation;
}

export function requiredSlotsFor(intent: IntentName): string[] {
  return INTENT_CATALOG[intent].requiredSlots;
}

/** Which required slots are still missing from what's been extracted so far — drives the
 * "ask the minimum necessary follow-up" rule (doc §6.2). */
export function missingRequiredSlots(intent: IntentName, slots: Record<string, string>): string[] {
  return requiredSlotsFor(intent).filter((key) => !slots[key]);
}
