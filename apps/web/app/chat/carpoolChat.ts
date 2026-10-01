import "server-only";

/**
 * Phase C6 — conversational (chat / voice) layer for Smart Carpool.
 *
 * This module is GLUE ONLY. It contains no carpool business rules: every state change goes
 * through the very same server actions the web UI uses (apps/web/app/carpool/requestActions.ts,
 * which delegate to the security-definer RPCs), and every search goes through the same
 * runCarpoolFirst / searchCompatibleCarpool pipeline as New Trip. The LLM never produces an id:
 * the slots that anchor a mutating intent (`tripRequestId`, `offerId`, `requestId`) are resolved
 * HERE, from the caller's OWN data only, before the confirmation card is shown, and are
 * re-resolved from scratch at confirm time (`executeCarpoolIntent`) — a value echoed back by the
 * client is only ever a hint to pick among rows the caller is allowed to see.
 *
 * Two entry points:
 *  - `prepareCarpoolIntent` / `prepareFromOption`: BEFORE confirmation — resolve references,
 *    ask ONE focused clarification, or build the confirmation card / numbered options. Mutates
 *    nothing.
 *  - `executeCarpoolIntent`: only called by dispatch.ts at the confirm phase.
 *
 * This is not a "use server" file: its exports are not client-reachable actions.
 */

import { randomUUID } from "node:crypto";
import { isCarpoolIntent, isValidSeatCount, type IntentName } from "@fleet/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/getLocale";
import { dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import { formatDateTimeShort } from "@/lib/formatDateTime";
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import {
  buildOfferCards,
  deriveCarpoolGating,
  runCarpoolFirst,
  type CarpoolFirstState,
  type CarpoolGating,
  type PlaceCheck,
} from "@/lib/carpool/carpoolFirst";
import { resolveLocationText } from "@/lib/carpool/resolveLocationText";
import { loadOfferCardRows } from "@/lib/carpool/offerCardRows";
import { carpoolErrorText, fillTemplate } from "@/lib/carpool/errorText";
import { isUuid } from "@/lib/carpool/rpcErrors";
import { VEHICLE_OPTION_ID } from "./persistedPending";
import type { RiderTripDraft } from "@/lib/carpool/runCarpoolSearch";
import { createGooglePlacesProvider } from "@/lib/geospatial/googlePlacesProvider";
import { listCorporateMobilityPoints } from "@/lib/geospatial/corporateMobilityPoints";
import { searchCompatibleCarpoolForChat } from "@/app/carpool/actions";
import {
  acceptCarpoolRequest,
  cancelCarpoolRequest,
  disableCarpoolOffer,
  enableCarpoolOffer,
  rejectCarpoolRequest,
  requestCarpoolRide,
  updateCarpoolOffer,
} from "@/app/carpool/requestActions";
import { getMyCarpoolRequestStatus } from "@/app/carpool/formActions";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const TZ = "America/Sao_Paulo";

/** The extra numbered choice "use a vehicle" shown next to carpool offers in a chat reservation. */
export { VEHICLE_OPTION_ID };

export interface ChatOption {
  id: string;
  label: string;
}

export interface ChatCarpoolCtx {
  supabase: Supabase;
  userId: string;
  organizationId: string;
  locale: Locale;
  dict: Dictionary;
  gating: CarpoolGating;
}

export type CarpoolPrepared =
  /** Nothing pending: a clarifying question, a refusal or an informational answer. */
  | { kind: "reply"; message: string }
  /** A confirmation card (Confirmar / Alterar / Cancelar) for a mutating intent. */
  | { kind: "confirm"; slots: Record<string, string>; summary: string }
  /** Numbered options the user must pick from (read-only search result / carpool-first). */
  | { kind: "options"; slots: Record<string, string>; summary: string; options: ChatOption[] };

export interface ExecResult {
  success: boolean;
  /** Success: the user-facing text. Failure: a stable code (never shown directly). */
  message: string;
  /** Already-localized, human-readable reasons (safe to show as-is). */
  reasons?: string[];
}

/** Keys that identify rows; the LLM must never supply them (the server resolves them). */
const SERVER_RESOLVED_KEYS = ["offerId", "requestId", "tripRequestId", "reservationId", "clientRequestId"];

export function stripServerResolvedSlots(slots: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(slots)) {
    if (SERVER_RESOLVED_KEYS.includes(k)) continue;
    if (typeof v === "string") clean[k] = v;
  }
  return clean;
}

// ------------------------------------------------------------------------------------------
// context

export async function loadChatCarpoolCtx(
  supabase: Supabase,
  userId: string,
  preloaded?: { organizationId: string; gating: CarpoolGating },
): Promise<ChatCarpoolCtx | null> {
  let organizationId = preloaded?.organizationId;
  if (!organizationId) {
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", userId).single();
    if (!profile) return null;
    organizationId = profile.organization_id;
  }
  const gating = preloaded?.gating ?? deriveCarpoolGating(await loadLatestPolicy(supabase, organizationId));
  const locale = await getLocale();
  return { supabase, userId, organizationId, locale, dict: dictionaries[locale], gating };
}

// ------------------------------------------------------------------------------------------
// small pure helpers

const norm = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const spDate = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
const timeLabel = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleTimeString(locale, { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

function seatsPhrase(ctx: ChatCarpoolCtx, n: number): string {
  return fillTemplate(n === 1 ? ctx.dict.chat.carpool.seatsOne : ctx.dict.chat.carpool.seatsOther, { count: n });
}

const reply = (message: string): CarpoolPrepared => ({ kind: "reply", message });

function fail(ctx: ChatCarpoolCtx, code: string): ExecResult {
  return { success: false, message: code, reasons: [carpoolErrorText(ctx.dict, code)] };
}

function parseSeats(raw: string | undefined): number | null {
  const n = Number(String(raw ?? "").trim());
  return Number.isInteger(n) && isValidSeatCount(n) ? n : null;
}

/** Hints the LLM may pass to tell trips apart; both optional, both only used as filters. */
function hintsFrom(slots: Record<string, string>): { tripDate?: string; destination?: string } {
  const tripDate = /^\d{4}-\d{2}-\d{2}$/.test(slots.tripDate ?? "") ? slots.tripDate : undefined;
  const destination = slots.destination?.trim() ? norm(slots.destination) : undefined;
  return { tripDate, destination };
}

function matchesDestination(actual: string, hint: string | undefined): boolean {
  if (!hint) return true;
  const a = norm(actual);
  return a.includes(hint) || hint.includes(a);
}

// ------------------------------------------------------------------------------------------
// own-data readers (all scoped to the caller; RLS applies on top)

interface HostTrip {
  reservationId: string;
  tripRequestId: string;
  destination: string;
  departureAt: string;
}

async function findHostTrips(
  ctx: ChatCarpoolCtx,
  filter: { tripRequestId?: string; tripDate?: string; destination?: string },
): Promise<HostTrip[]> {
  const { data } = await ctx.supabase
    .from("reservations")
    .select("id, trip_request:trip_requests!inner(id, requester_id, destination, departure_at)")
    .eq("trip_request.requester_id", ctx.userId)
    .in("status", ["pending_approval", "confirmed"]);
  const now = Date.now();
  return (data ?? [])
    .filter((r) => r.trip_request && new Date(r.trip_request.departure_at).getTime() > now)
    .map((r) => ({
      reservationId: r.id,
      tripRequestId: r.trip_request!.id,
      destination: r.trip_request!.destination,
      departureAt: r.trip_request!.departure_at,
    }))
    .filter((t) => !filter.tripRequestId || t.tripRequestId === filter.tripRequestId)
    .filter((t) => !filter.tripDate || spDate(t.departureAt) === filter.tripDate)
    .filter((t) => matchesDestination(t.destination, filter.destination))
    .sort((a, b) => (a.departureAt < b.departureAt ? -1 : 1));
}

interface OwnOffer {
  id: string;
  tripRequestId: string;
  status: string;
  seatsOffered: number;
  seatsAvailable: number;
  destination: string;
  departureAt: string;
}

async function findOwnOffers(ctx: ChatCarpoolCtx, onlyActive: boolean): Promise<OwnOffer[]> {
  let query = ctx.supabase
    .from("carpool_offers")
    .select("id, trip_request_id, status, seats_offered, seats_available, created_at, trip_request:trip_requests(destination, departure_at)")
    .eq("host_id", ctx.userId)
    .order("created_at", { ascending: false });
  if (onlyActive) query = query.eq("status", "active");
  const { data } = await query;
  return (data ?? [])
    .filter((o) => o.trip_request)
    .map((o) => ({
      id: o.id,
      tripRequestId: o.trip_request_id,
      status: o.status,
      seatsOffered: o.seats_offered,
      seatsAvailable: o.seats_available,
      destination: o.trip_request!.destination,
      departureAt: o.trip_request!.departure_at,
    }));
}

interface PendingRequestForHost {
  id: string;
  riderName: string;
  seats: number;
  departureAt: string;
}

/** ONLY pending requests on offers whose host is the caller (never anyone else's). */
async function findHostPendingRequests(ctx: ChatCarpoolCtx): Promise<PendingRequestForHost[]> {
  const offers = await findOwnOffers(ctx, false);
  if (offers.length === 0) return [];
  const { data } = await ctx.supabase
    .from("carpool_ride_requests")
    .select("id, requested_seats, requested_departure_at, rider:profiles!rider_id(full_name)")
    .in("carpool_offer_id", offers.map((o) => o.id))
    .eq("status", "PENDING")
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id,
    riderName: r.rider?.full_name ?? "",
    seats: r.requested_seats,
    departureAt: r.requested_departure_at,
  }));
}

interface OwnRiderRequest {
  id: string;
  status: string;
  departureAt: string;
}

/** The caller's OWN live requests (as rider). */
async function findOwnRiderRequests(ctx: ChatCarpoolCtx): Promise<OwnRiderRequest[]> {
  const { data } = await ctx.supabase
    .from("carpool_ride_requests")
    .select("id, status, requested_departure_at")
    .eq("rider_id", ctx.userId)
    .in("status", ["PENDING", "ACCEPTED"])
    .order("requested_departure_at", { ascending: true });
  return (data ?? []).map((r) => ({ id: r.id, status: r.status, departureAt: r.requested_departure_at }));
}

// ------------------------------------------------------------------------------------------
// rider search (FIND / REQUEST / carpool-first in a chat reservation)

export interface SearchSlots {
  origin: string;
  destination: string;
  departureAt: string;
  passengerCount: number;
  requiresCargo: boolean;
}

function readSearchSlots(slots: Record<string, string>): SearchSlots | { missing: "destination" | "origin" | "departureAt" } {
  const destination = (slots.destination ?? "").trim();
  if (!destination) return { missing: "destination" };
  const when = new Date(slots.departureAt ?? "");
  if (!slots.departureAt || !Number.isFinite(when.getTime())) return { missing: "departureAt" };
  const origin = (slots.origin ?? "").trim();
  if (!origin) return { missing: "origin" };
  const count = Number(slots.passengerCount ?? 1);
  return {
    origin,
    destination,
    departureAt: when.toISOString(),
    passengerCount: Number.isInteger(count) && count >= 1 ? count : 1,
    requiresCargo: slots.requiresCargo === "true",
  };
}

async function riderPlaceDeps(ctx: ChatCarpoolCtx) {
  const geocoder = createGooglePlacesProvider(ctx.organizationId);
  const pointsResult = await listCorporateMobilityPoints(ctx.supabase, ctx.organizationId);
  const points = pointsResult.status === "ok" ? pointsResult.data : [];
  return { geocoder, points, resolve: (text: string) => resolveLocationText(text, { points, geocoder, places: geocoder }) };
}

/** Same pipeline as New Trip's planTripAction (resolve -> clarification rule -> geospatial search). */
async function runRiderSearch(ctx: ChatCarpoolCtx, s: SearchSlots): Promise<CarpoolFirstState> {
  const { resolve } = await riderPlaceDeps(ctx);
  return runCarpoolFirst(
    {
      originText: s.origin,
      destinationText: s.destination,
      departureAt: s.departureAt,
      passengerCount: s.passengerCount,
      requiresCargo: s.requiresCargo,
    },
    {
      resolve,
      search: (draft) => searchCompatibleCarpoolForChat(draft),
      loadOfferCards: async (matches) =>
        buildOfferCards(
          matches,
          await loadOfferCardRows(
            ctx.organizationId,
            matches.map((m) => m.offerId),
          ),
        ),
    },
  );
}

function precisionMessage(ctx: ChatCarpoolCtx, state: Extract<CarpoolFirstState, { status: "needs_precision" }>): string {
  const t = ctx.dict.carpool.newTrip;
  const byReason: Record<string, string> = {
    city_level: t.cityLevel,
    state_level: t.stateLevel,
    neighborhood_level: t.neighborhoodLevel,
    postal_code: t.postalCode,
    empty: t.empty,
    not_found: t.notFound,
  };
  const failing: { check: PlaceCheck & { ok: false }; field: string }[] = [];
  if (!state.origin.ok) failing.push({ check: state.origin, field: t.originField });
  if (!state.destination.ok) failing.push({ check: state.destination, field: t.destinationField });
  return failing
    .map(({ check, field }) => fillTemplate(byReason[check.reason] ?? t.notFound, { text: check.query, field }))
    .join("\n");
}

function offerOptions(ctx: ChatCarpoolCtx, state: Extract<CarpoolFirstState, { status: "offers" }>): ChatOption[] {
  return state.offers.map((o) => ({
    id: o.offerId,
    label: fillTemplate(ctx.dict.chat.carpool.optionLabel, {
      time: timeLabel(o.hostDepartureAt, ctx.locale),
      km: o.additionalDistanceKm,
      min: o.additionalTimeMin,
      seats: seatsPhrase(ctx, o.seatsAvailable),
    }),
  }));
}

/** Display-only shortening of a provider label: drops the postal code and the trailing country
 * ("..., 01310-200, Brazil"). The stored/resolved label is never modified. */
export function shortPlaceLabel(label: string): string {
  return label
    .replace(/,?\s*\b\d{5}-?\d{3}\b/g, "")
    .replace(/,\s*(Brazil|Brasil|Brésil|Brasilien|巴西)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const placesLine = (ctx: ChatCarpoolCtx, origin: { label: string }, destination: { label: string }) =>
  fillTemplate(ctx.dict.chat.carpool.placesUnderstood, {
    origin: shortPlaceLabel(origin.label),
    destination: shortPlaceLabel(destination.label),
  });

function searchSlotsToPending(s: SearchSlots): Record<string, string> {
  return {
    origin: s.origin,
    destination: s.destination,
    departureAt: s.departureAt,
    passengerCount: String(s.passengerCount),
    requiresCargo: String(s.requiresCargo),
  };
}

async function prepareFind(ctx: ChatCarpoolCtx, slots: Record<string, string>): Promise<CarpoolPrepared> {
  if (!ctx.gating.newEngine) return reply(carpoolErrorText(ctx.dict, "CARPOOL_DISABLED_BY_POLICY"));
  const s = readSearchSlots(slots);
  if ("missing" in s) {
    // The orchestrator normally asks for destination/time itself; this is the safety net, and
    // the only place the missing ORIGIN is asked (a pickup point is never guessed).
    return reply(
      s.missing === "origin"
        ? ctx.dict.chat.carpool.askOrigin
        : s.missing === "destination"
          ? ctx.dict.carpool.newTrip.empty.replace("{field}", ctx.dict.carpool.newTrip.destinationField)
          : ctx.dict.carpool.newTrip.empty.replace("{field}", ctx.dict.carpool.newTrip.originField),
    );
  }
  const state = await runRiderSearch(ctx, s);
  switch (state.status) {
    case "unavailable":
      // Outage: say so, never invent a match.
      return reply(ctx.dict.carpool.newTrip.unavailableBanner);
    case "needs_precision":
      return reply(precisionMessage(ctx, state));
    case "none":
      return reply(`${placesLine(ctx, state.origin, state.destination)}\n${ctx.dict.chat.carpool.findNone}`);
    case "offers":
      return {
        kind: "options",
        slots: searchSlotsToPending(s),
        summary: `${placesLine(ctx, state.origin, state.destination)}\n${ctx.dict.chat.carpool.findOffers}`,
        options: offerOptions(ctx, state),
      };
  }
}

/** Builds the REQUEST_CARPOOL confirmation card for one offer of a (re-run) search. */
async function buildRequestCard(ctx: ChatCarpoolCtx, search: Record<string, string>, offerId: string): Promise<CarpoolPrepared> {
  if (!ctx.gating.newEngine) return reply(carpoolErrorText(ctx.dict, "CARPOOL_DISABLED_BY_POLICY"));
  if (!isUuid(offerId)) return reply(carpoolErrorText(ctx.dict, "offer_not_compatible"));
  const s = readSearchSlots(search);
  if ("missing" in s) return reply(ctx.dict.chat.carpool.noRecentSearch);
  // Re-validated server-side: the offer must still be among the COMPATIBLE results right now.
  const state = await runRiderSearch(ctx, s);
  if (state.status === "unavailable") return reply(ctx.dict.carpool.newTrip.unavailableBanner);
  if (state.status === "needs_precision") return reply(precisionMessage(ctx, state));
  const card = state.status === "offers" ? state.offers.find((o) => o.offerId === offerId) : undefined;
  if (state.status !== "offers" || !card) return reply(carpoolErrorText(ctx.dict, "offer_not_compatible"));

  const summary =
    `${placesLine(ctx, state.origin, state.destination)}\n` +
    fillTemplate(ctx.dict.chat.carpool.requestSummary, {
      seats: seatsPhrase(ctx, s.passengerCount),
      time: timeLabel(card.hostDepartureAt, ctx.locale),
      km: card.additionalDistanceKm,
      min: card.additionalTimeMin,
    }) +
    (ctx.gating.hostApprovalRequired ? ctx.dict.chat.carpool.requestApprovalNote : "");
  return {
    kind: "confirm",
    slots: { ...searchSlotsToPending(s), offerId, clientRequestId: randomUUID() },
    summary,
  };
}

// ------------------------------------------------------------------------------------------
// BEFORE confirmation

export interface PendingLike {
  intent: IntentName;
  slots: Record<string, string>;
  options?: ChatOption[];
}

export async function prepareCarpoolIntent(
  ctx: ChatCarpoolCtx,
  intent: IntentName,
  rawSlots: Record<string, string>,
  prev?: PendingLike,
): Promise<CarpoolPrepared> {
  const slots = stripServerResolvedSlots(rawSlots);
  const t = ctx.dict.chat.carpool;
  const disabled = () => reply(carpoolErrorText(ctx.dict, "CARPOOL_DISABLED_BY_POLICY"));

  switch (intent) {
    case "FIND_CARPOOL":
      return prepareFind(ctx, slots);

    case "REQUEST_CARPOOL": {
      if (!ctx.gating.newEngine) return disabled();
      // "Pode solicitar essa carona": refers to the options the user was just shown. The client
      // echoes them back, but only as a hint — the offer is re-validated by a fresh search.
      const shown = prev?.options?.filter((o) => isUuid(o.id)) ?? [];
      if (!prev || shown.length === 0 || !(prev.intent === "FIND_CARPOOL" || prev.intent === "CREATE_RESERVATION")) {
        return reply(t.noRecentSearch);
      }
      let chosen: ChatOption | undefined;
      const n = Number(slots.optionNumber);
      if (Number.isInteger(n) && n >= 1) chosen = shown[n - 1];
      else if (shown.length === 1) chosen = shown[0];
      if (!chosen) return reply(t.pickOption);
      return buildRequestCard(ctx, prev.slots, chosen.id);
    }

    case "OFFER_CARPOOL": {
      if (!ctx.gating.newEngine) return disabled();
      const seats = parseSeats(slots.seats);
      if (seats === null) return reply(t.askSeats);
      const trips = await findHostTrips(ctx, hintsFrom(slots));
      if (trips.length === 0) return reply(t.noHostTrip);
      if (trips.length > 1) {
        const list = trips
          .map((x) => fillTemplate(t.tripListItem, { destination: x.destination, departure: formatDateTimeShort(x.departureAt, ctx.locale) }))
          .join("; ");
        return reply(fillTemplate(t.chooseTrip, { list }));
      }
      const trip = trips[0]!;
      const existing = (await findOwnOffers(ctx, false)).find((o) => o.tripRequestId === trip.tripRequestId);
      const updating = existing?.status === "active";
      const summary = fillTemplate(updating ? t.offerUpdateSummary : t.offerEnableSummary, {
        seats: seatsPhrase(ctx, seats),
        destination: trip.destination,
        departure: formatDateTimeShort(trip.departureAt, ctx.locale),
      });
      return { kind: "confirm", slots: { seats: String(seats), tripRequestId: trip.tripRequestId }, summary };
    }

    case "DISABLE_CARPOOL": {
      const hints = hintsFrom(slots);
      const offers = (await findOwnOffers(ctx, true))
        .filter((o) => !hints.tripDate || spDate(o.departureAt) === hints.tripDate)
        .filter((o) => matchesDestination(o.destination, hints.destination));
      if (offers.length === 0) return reply(t.noActiveOffer);
      if (offers.length > 1) {
        const list = offers
          .map((x) => fillTemplate(t.tripListItem, { destination: x.destination, departure: formatDateTimeShort(x.departureAt, ctx.locale) }))
          .join("; ");
        return reply(fillTemplate(t.chooseOffer, { list }));
      }
      const offer = offers[0]!;
      return {
        kind: "confirm",
        slots: { offerId: offer.id },
        summary: fillTemplate(t.disableSummary, {
          destination: offer.destination,
          departure: formatDateTimeShort(offer.departureAt, ctx.locale),
        }),
      };
    }

    case "ACCEPT_CARPOOL_REQUEST":
    case "REJECT_CARPOOL_REQUEST": {
      const pending = await findHostPendingRequests(ctx);
      const name = (slots.riderName ?? "").trim();
      let candidates = pending;
      if (name) {
        // Token-prefix, accent/case-insensitive match against the names of the caller's OWN
        // pending requests only ("Ana" matches "Ana Silva"; never anyone outside this set).
        const tokens = norm(name).split(" ");
        candidates = pending.filter((r) => {
          const parts = norm(r.riderName).split(" ");
          return tokens.every((tk) => parts.some((p) => p.startsWith(tk)));
        });
      }
      if (candidates.length === 0) {
        return reply(name ? fillTemplate(t.noPendingForName, { name }) : t.noPendingRequests);
      }
      if (candidates.length > 1) {
        const list = candidates
          .map((r) =>
            fillTemplate(t.requestListItem, {
              name: r.riderName,
              seats: seatsPhrase(ctx, r.seats),
              time: timeLabel(r.departureAt, ctx.locale),
            }),
          )
          .join("; ");
        return reply(fillTemplate(t.chooseRequest, { list }));
      }
      const target = candidates[0]!;
      const accepting = intent === "ACCEPT_CARPOOL_REQUEST";
      const out: Record<string, string> = { requestId: target.id, riderName: target.riderName };
      if (!accepting && slots.reason?.trim()) out.reason = slots.reason.trim().slice(0, 500);
      return {
        kind: "confirm",
        slots: out,
        summary: fillTemplate(accepting ? t.acceptSummary : t.rejectSummary, {
          name: target.riderName,
          seats: seatsPhrase(ctx, target.seats),
        }),
      };
    }

    case "CANCEL_CARPOOL_REQUEST": {
      const hint = /^\d{4}-\d{2}-\d{2}$/.test(slots.tripDate ?? "") ? slots.tripDate : undefined;
      const own = (await findOwnRiderRequests(ctx)).filter((r) => !hint || spDate(r.departureAt) === hint);
      if (own.length === 0) return reply(t.noCancellableRequest);
      if (own.length > 1) {
        const list = own
          .map((r) => fillTemplate(t.cancelListItem, { when: formatDateTimeShort(r.departureAt, ctx.locale) }))
          .join("; ");
        return reply(fillTemplate(t.chooseCancel, { list }));
      }
      const target = own[0]!;
      return {
        kind: "confirm",
        slots: { requestId: target.id },
        summary: fillTemplate(target.status === "ACCEPTED" ? t.cancelSummaryAccepted : t.cancelSummary, {
          when: formatDateTimeShort(target.departureAt, ctx.locale),
        }),
      };
    }

    default:
      return reply(carpoolErrorText(ctx.dict, "generic"));
  }
}

/**
 * The user picked one numbered option (button or number reply) from a FIND_CARPOOL result or a
 * carpool-first chat reservation. `optionId` is client-supplied, so it is only ever used to
 * pick an offer that the SERVER then re-validates with a fresh search.
 */
export async function prepareFromOption(
  ctx: ChatCarpoolCtx,
  pending: PendingLike,
  optionId: string,
): Promise<CarpoolPrepared | { kind: "vehicle" }> {
  if (pending.intent !== "FIND_CARPOOL" && pending.intent !== "CREATE_RESERVATION") {
    return reply(ctx.dict.chat.carpool.noRecentSearch);
  }
  if (optionId === VEHICLE_OPTION_ID) {
    return pending.intent === "CREATE_RESERVATION" ? { kind: "vehicle" } : reply(ctx.dict.chat.carpool.noRecentSearch);
  }
  return buildRequestCard(ctx, pending.slots, optionId);
}

/**
 * Carpool-first for a chat CREATE_RESERVATION (parity with New Trip). Returns options only when
 * compatible offers exist; any other outcome lets the normal vehicle card proceed (with a note
 * when the search could not run).
 */
export async function carpoolFirstForReservation(
  ctx: ChatCarpoolCtx,
  slots: Record<string, string>,
): Promise<{ kind: "none"; note?: string } | { kind: "options"; summary: string; options: ChatOption[] }> {
  if (!ctx.gating.carpoolFirst || slots.carpoolDeclined === "true") return { kind: "none" };
  const s = readSearchSlots(slots);
  if ("missing" in s) return { kind: "none" };
  const state = await runRiderSearch(ctx, s);
  if (state.status === "unavailable") return { kind: "none", note: ctx.dict.carpool.newTrip.unavailableBanner };
  if (state.status === "needs_precision") return { kind: "none", note: precisionMessage(ctx, state) };
  if (state.status === "none") return { kind: "none" };
  return {
    kind: "options",
    summary: `${placesLine(ctx, state.origin, state.destination)}\n${ctx.dict.chat.carpool.carpoolFirstIntro}`,
    options: [...offerOptions(ctx, state), { id: VEHICLE_OPTION_ID, label: ctx.dict.chat.carpool.useVehicle }],
  };
}

// ------------------------------------------------------------------------------------------
// AT confirmation (called only from dispatch.ts)

export async function executeCarpoolIntent(
  ctx: ChatCarpoolCtx,
  intent: IntentName,
  slots: Record<string, string>,
): Promise<ExecResult> {
  const t = ctx.dict.chat.carpool;
  if (!isCarpoolIntent(intent)) return { success: false, message: "not_supported_via_chat" };

  switch (intent) {
    case "FIND_CARPOOL": {
      // Read-only. (The chat normally renders this as numbered buttons via prepareCarpoolIntent;
      // this text form serves any direct dispatch.)
      const prepared = await prepareFind(ctx, stripServerResolvedSlots(slots));
      if (prepared.kind === "reply") return { success: true, message: prepared.message };
      if (prepared.kind === "options") {
        const lines = prepared.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
        return { success: true, message: `${prepared.summary}\n${lines}` };
      }
      return { success: true, message: prepared.summary };
    }

    case "OFFER_CARPOOL": {
      if (!ctx.gating.newEngine) return fail(ctx, "CARPOOL_DISABLED_BY_POLICY");
      const seats = parseSeats(slots.seats);
      if (seats === null) return fail(ctx, "CARPOOL_INVALID_SEATS");
      if (!isUuid(slots.tripRequestId)) return fail(ctx, "CARPOOL_TRIP_NOT_FOUND");
      // Re-resolved among the caller's OWN upcoming trips (never trusting the echoed id alone).
      const trip = (await findHostTrips(ctx, { tripRequestId: slots.tripRequestId }))[0];
      if (!trip) return fail(ctx, "CARPOOL_TRIP_NOT_FOUND");
      const existing = (await findOwnOffers(ctx, false)).find((o) => o.tripRequestId === trip.tripRequestId);
      const updating = existing?.status === "active";
      const result = updating
        ? await updateCarpoolOffer(existing!.id, seats, trip.reservationId)
        : await enableCarpoolOffer(trip.tripRequestId, seats, trip.reservationId);
      if (result.status === "error") return fail(ctx, result.error);
      return {
        success: true,
        message: fillTemplate(updating ? t.offerUpdateDone : t.offerEnableDone, {
          seats: seatsPhrase(ctx, seats),
          destination: trip.destination,
        }),
      };
    }

    case "DISABLE_CARPOOL": {
      if (!isUuid(slots.offerId)) return fail(ctx, "CARPOOL_OFFER_NOT_FOUND");
      // Only an offer the caller HOSTS can be disabled through chat.
      const offer = (await findOwnOffers(ctx, false)).find((o) => o.id === slots.offerId);
      if (!offer) return fail(ctx, "CARPOOL_OFFER_NOT_FOUND");
      const result = await disableCarpoolOffer(offer.id);
      if (result.status === "error") return fail(ctx, result.error);
      return { success: true, message: fillTemplate(t.disableDone, { destination: offer.destination }) };
    }

    case "REQUEST_CARPOOL": {
      if (!ctx.gating.newEngine) return fail(ctx, "CARPOOL_DISABLED_BY_POLICY");
      if (!isUuid(slots.offerId)) return fail(ctx, "offer_not_compatible");
      const s = readSearchSlots(slots);
      if ("missing" in s) return fail(ctx, "invalid_input");
      const { resolve } = await riderPlaceDeps(ctx);
      const [o, d] = await Promise.all([resolve(s.origin), resolve(s.destination)]);
      if (o.status === "unavailable" || d.status === "unavailable") return fail(ctx, "carpool_unavailable");
      if (o.status !== "resolved" || d.status !== "resolved") return fail(ctx, "offer_not_compatible");
      const draft: RiderTripDraft = {
        requestedDepartureAt: s.departureAt,
        requestedSeats: s.passengerCount,
        requiresCargo: s.requiresCargo,
        pickup: o.place.coordinates,
        dropoff: d.place.coordinates,
      };
      const result = await requestCarpoolRide({
        offerId: slots.offerId,
        clientRequestId: isUuid(slots.clientRequestId) ? slots.clientRequestId : randomUUID(),
        draft,
        pickupLabel: o.place.label,
        dropoffLabel: d.place.label,
      });
      if (result.status === "error") return fail(ctx, result.error);
      const outcome = await getMyCarpoolRequestStatus(result.requestId);
      return {
        success: true,
        message:
          outcome?.status === "ACCEPTED"
            ? ctx.dict.carpool.newTrip.outcomeAccepted
            : ctx.dict.carpool.newTrip.outcomePending,
      };
    }

    case "ACCEPT_CARPOOL_REQUEST":
    case "REJECT_CARPOOL_REQUEST": {
      if (!isUuid(slots.requestId)) return fail(ctx, "CARPOOL_REQUEST_NOT_FOUND");
      // Must be a pending request on one of the caller's OWN offers; anything else is "not found".
      const target = (await findHostPendingRequests(ctx)).find((r) => r.id === slots.requestId);
      if (!target) return fail(ctx, "CARPOOL_REQUEST_NOT_FOUND");
      if (intent === "ACCEPT_CARPOOL_REQUEST") {
        const result = await acceptCarpoolRequest(target.id);
        if (result.status === "error") return fail(ctx, result.error);
        return { success: true, message: fillTemplate(t.acceptDone, { name: target.riderName }) };
      }
      const result = await rejectCarpoolRequest(target.id, slots.reason);
      if (result.status === "error") return fail(ctx, result.error);
      return { success: true, message: fillTemplate(t.rejectDone, { name: target.riderName }) };
    }

    case "CANCEL_CARPOOL_REQUEST": {
      if (!isUuid(slots.requestId)) return fail(ctx, "CARPOOL_REQUEST_NOT_FOUND");
      const own = (await findOwnRiderRequests(ctx)).find((r) => r.id === slots.requestId);
      if (!own) return fail(ctx, "CARPOOL_REQUEST_NOT_FOUND");
      const result = await cancelCarpoolRequest(own.id);
      if (result.status === "error") return fail(ctx, result.error);
      return { success: true, message: t.cancelDone };
    }

    default:
      return { success: false, message: "not_supported_via_chat" };
  }
}

// ------------------------------------------------------------------------------------------
// host offer step of a chat reservation (parity with confirmTrip)

/**
 * After create_vehicle_reservation succeeded and the user answered Yes to "offer seats":
 * publish through the SAME enable_carpool_offer path as the web form. Never throws and never
 * undoes the reservation: returns the sentence to append to the success message.
 */
export async function publishOfferForNewReservation(
  ctx: ChatCarpoolCtx,
  args: { reservationId: string; maxSeats: number; requestedSeats?: string },
): Promise<string> {
  const t = ctx.dict.chat.carpool;
  if (!ctx.gating.hostStep) return "";
  // Default = the maximum safe number (capacity - declared occupants); an explicit number that
  // is not within [1, max] is not clamped silently — it is treated like the form: invalid.
  const requested = args.requestedSeats ? Number(args.requestedSeats) : args.maxSeats;
  if (args.maxSeats < 1) return ` ${ctx.dict.carpool.newTrip.noFreeSeats}`;
  if (!Number.isInteger(requested) || requested < 1 || requested > args.maxSeats) return t.reservationOfferFailed;
  const { data: created } = await ctx.supabase
    .from("reservations")
    .select("trip_request_id")
    .eq("id", args.reservationId)
    .maybeSingle();
  if (!created?.trip_request_id) return t.reservationOfferFailed;
  const published = await enableCarpoolOffer(created.trip_request_id, requested, args.reservationId);
  if (published.status === "error") return t.reservationOfferFailed;
  return fillTemplate(t.reservationOfferPublished, { seats: seatsPhrase(ctx, requested) });
}

export function offerNoteForReservation(ctx: ChatCarpoolCtx, seats: number): string {
  if (seats < 1) return "";
  return fillTemplate(ctx.dict.chat.carpool.reservationOfferNote, { seats: seatsPhrase(ctx, seats) });
}
