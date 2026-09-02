import type { EnergyType, Vehicle } from "../entities/vehicle";
import type { TripRequest } from "../entities/trip";

/**
 * One restricted circulation window for a given São Paulo local weekday.
 * `weekday` follows JS `Date#getDay()` convention: 0 = Sunday … 6 = Saturday.
 * `startHour`/`endHour` are São Paulo local hours (0-23); the window is
 * [startHour, endHour) — inclusive start, exclusive end.
 */
export interface TrafficRestrictionRule {
  weekday: number;
  /** Last digit(s) of the plate restricted during this window. */
  lastDigits: number[];
  startHour: number;
  endHour: number;
}

export interface TrafficRestrictionConfig {
  rules: TrafficRestrictionRule[];
  /**
   * Destination names (case/diacritic-insensitive) treated as falling inside the
   * restricted zone. This is an exact-city-name proxy, not real geofencing — see
   * findCarpoolMatches' destination matching for the same class of simplification.
   */
  restrictedZoneCities: string[];
  /** Energy types exempt from the restriction regardless of plate/window (rodízio exempts BEVs). */
  exemptEnergyTypes: EnergyType[];
}

export interface TrafficRestrictionResult {
  restricted: boolean;
  reasons: string[];
}

/**
 * Best-effort model of São Paulo municipal "rodízio de veículos" (circulation restriction
 * by last plate digit, administered by CET-SP under Lei Municipal 12.490/1997 and its
 * successors) as of this package's last knowledge update.
 *
 * fleet-car-saas.txt §15 is explicit: "Não invente regras regulatórias atuais. Elas devem
 * vir de fonte/configuração confiável quando implementadas." This table is therefore kept
 * as plain configuration data — not hardcoded branching logic — precisely so it can be
 * corrected or replaced from a trusted source without touching `checkTrafficRestriction`.
 * IT MUST BE VERIFIED AGAINST THE OFFICIAL, CURRENT CET-SP RULE BEFORE THIS DEFAULT IS
 * TRUSTED IN A PRODUCTION DEPLOYMENT.
 *
 * Modeled rule: weekdays only, two windows per day (07:00–10:00 and 17:00–20:00), one pair
 * of last-plate-digits per weekday (Mon 1-2, Tue 3-4, Wed 5-6, Thu 7-8, Fri 9-0). Fully
 * electric vehicles (BEV) are exempt; PHEV/ICE are not.
 */
export const defaultTrafficRestrictionConfig: TrafficRestrictionConfig = {
  rules: [
    { weekday: 1, lastDigits: [1, 2], startHour: 7, endHour: 10 },
    { weekday: 1, lastDigits: [1, 2], startHour: 17, endHour: 20 },
    { weekday: 2, lastDigits: [3, 4], startHour: 7, endHour: 10 },
    { weekday: 2, lastDigits: [3, 4], startHour: 17, endHour: 20 },
    { weekday: 3, lastDigits: [5, 6], startHour: 7, endHour: 10 },
    { weekday: 3, lastDigits: [5, 6], startHour: 17, endHour: 20 },
    { weekday: 4, lastDigits: [7, 8], startHour: 7, endHour: 10 },
    { weekday: 4, lastDigits: [7, 8], startHour: 17, endHour: 20 },
    { weekday: 5, lastDigits: [9, 0], startHour: 7, endHour: 10 },
    { weekday: 5, lastDigits: [9, 0], startHour: 17, endHour: 20 },
  ],
  restrictedZoneCities: ["São Paulo", "Sao Paulo"],
  exemptEnergyTypes: ["BEV"],
};

/** Brazil abolished daylight saving time in 2019; São Paulo civil time is a fixed UTC-3. */
const SAO_PAULO_UTC_OFFSET_HOURS = -3;

function saoPauloLocalParts(iso: string): { weekday: number; hour: number } {
  const localMs = new Date(iso).getTime() + SAO_PAULO_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const local = new Date(localMs);
  return { weekday: local.getUTCDay(), hour: local.getUTCHours() };
}

const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;

function normalizeCityName(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_DIACRITICAL_MARKS, "")
    .trim()
    .toLowerCase();
}

function extractLastPlateDigit(plate: string): number | null {
  const lastChar = plate.trim().slice(-1);
  return /^[0-9]$/.test(lastChar) ? Number(lastChar) : null;
}

/**
 * "Com base no veículo, placa, combustível, data, horário, origem e destino, a plataforma
 * deverá alertar sobre eventuais restrições de circulação aplicáveis à viagem, como rodízio
 * em São Paulo." (fleet-car-saas.txt §15). Checks a single trip/vehicle pair against a
 * configurable set of circulation-restriction rules — see `defaultTrafficRestrictionConfig`
 * for the caveat about its rule table's currency.
 */
export function checkTrafficRestriction(
  vehicle: Pick<Vehicle, "plate" | "energyType">,
  trip: Pick<TripRequest, "destination" | "departureAt">,
  config: TrafficRestrictionConfig,
): TrafficRestrictionResult {
  const destination = normalizeCityName(trip.destination);
  const inRestrictedZone = config.restrictedZoneCities.some(
    (city) => normalizeCityName(city) === destination,
  );
  if (!inRestrictedZone) {
    return { restricted: false, reasons: ["not_applicable_destination"] };
  }

  if (config.exemptEnergyTypes.includes(vehicle.energyType)) {
    return { restricted: false, reasons: ["bev_exempt"] };
  }

  const { weekday, hour } = saoPauloLocalParts(trip.departureAt);
  const applicableRule = config.rules.find(
    (rule) => rule.weekday === weekday && hour >= rule.startHour && hour < rule.endHour,
  );
  if (!applicableRule) {
    return { restricted: false, reasons: ["outside_restricted_hours"] };
  }

  const lastDigit = extractLastPlateDigit(vehicle.plate);
  if (lastDigit === null || !applicableRule.lastDigits.includes(lastDigit)) {
    return { restricted: false, reasons: ["plate_digit_not_restricted_today"] };
  }

  return { restricted: true, reasons: ["rodizio_sp_active"] };
}
