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
    requiredSlots: ["departureAt", "expectedReturnAt", "destination"],
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
};

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
