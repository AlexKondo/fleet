import type { LatLng } from "@fleet/domain";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ResolveOutcome } from "@/lib/carpool/resolveLocationText";
import { fillTemplate } from "@/lib/carpool/errorText";

/**
 * A vehicle is recommended for the trip's real distance (autonomy), so the assistant needs concrete places first: the origin and the destination
 * are located on the map before any vehicle is suggested. If one cannot be located with enough precision the assistant asks for it, politely,
 * and does NOT build a vehicle card or a reservation. When the map service is unavailable the check cannot run and the flow goes on as before.
 */
export interface PlaceVerificationDeps {
  resolve: (text: string) => Promise<ResolveOutcome>;
  /** the different places the Places search offers for a name (the site's autocomplete options) */
  candidates?: (text: string) => Promise<{ label: string }[]>;
  route: (origin: LatLng, destination: LatLng) => Promise<{ status: "ok"; distanceKm: number } | { status: string }>;
}

export type PlaceVerification =
  /** `destinationLabel`: the destination as located on the map (shown back to the person and stored instead of a vague name) */
  | { status: "ok"; distanceKm?: number; destinationLabel?: string }
  | { status: "ask"; message: string }
  /** a place NAME that fits several buildings: the person picks one, like in the site's autocomplete */
  | { status: "choose"; text: string; candidates: { label: string }[] }
  | { status: "unverified" };

const REASON_KEY = {
  city_level: "cityLevel",
  state_level: "stateLevel",
  neighborhood_level: "neighborhoodLevel",
  postal_code: "postalCode",
  not_found: "notFound",
  empty: "empty",
} as const;

export async function verifyReservationPlaces(
  slots: Record<string, string>,
  deps: PlaceVerificationDeps,
  dict: Dictionary,
  opts: { allowChoice?: boolean } = {},
): Promise<PlaceVerification> {
  const t = dict.carpool.newTrip;
  const fields = [
    { text: (slots.origin ?? "").trim(), label: t.originField },
    { text: (slots.destination ?? "").trim(), label: t.destinationField },
  ];
  const outcomes: ResolveOutcome[] = [];
  for (const f of fields) {
    try {
      outcomes.push(await deps.resolve(f.text));
    } catch {
      return { status: "unverified" };
    }
  }
  if (outcomes.some((o) => o.status === "unavailable")) return { status: "unverified" };

  const lines: string[] = [];
  outcomes.forEach((o, i) => {
    if (o.status === "needs_precision") lines.push(fillTemplate(t[REASON_KEY[o.reason]], { text: fields[i]!.text, field: fields[i]!.label }));
  });
  if (lines.length > 0) {
    return { status: "ask", message: fillTemplate(dict.chat.replies.addressAsk, { details: lines.join("\n") }) };
  }

  const dest = outcomes[1] as { status: "resolved"; place: { viaPlacesSearch?: true } };
  if (opts.allowChoice !== false && dest.place.viaPlacesSearch && deps.candidates) {
    try {
      const found = await deps.candidates(fields[1]!.text);
      if (found.length >= 2) return { status: "choose", text: fields[1]!.text, candidates: found.slice(0, 3) };
    } catch {
      // without the options the first match is used
    }
  }

  const [from, to] = outcomes as { status: "resolved"; place: { coordinates: LatLng; label?: string } }[];
  const destinationLabel = to!.place.label?.trim() ? to!.place.label.trim().slice(0, 200) : undefined;
  try {
    const route = await deps.route(from!.place.coordinates, to!.place.coordinates);
    if (route.status === "ok") return { status: "ok", distanceKm: Math.max(1, Math.round((route as { distanceKm: number }).distanceKm)), destinationLabel };
  } catch {
    // the route is a refinement: the places are concrete, the vehicle can still be recommended
  }
  return { status: "ok", destinationLabel };
}
