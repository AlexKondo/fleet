import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { formatDateTime, formatDateTimeShort } from "@/lib/formatDateTime";
import { AppShell } from "../AppShell";
import { leaveCarpool } from "./actions";
import { riderCancelRequest } from "../carpool/formActions";
import { carpoolErrorText, carpoolReasonText, carpoolStatusText, fillTemplate } from "@/lib/carpool/errorText";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { ReservationGantt } from "../ReservationGantt";
import type { GanttZoomLevel } from "../ganttZoomActions";

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ tripActionError?: string; carpoolActionError?: string }>;
}) {
  const { tripActionError, carpoolActionError } = await searchParams;
  const dict = await getDictionary();
  const locale = await getLocale();
  const reservationStatusLabel = (status: string): string =>
    (dict.trips.statuses as Record<string, string>)[status] ?? status;
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  // All three are keyed only by `user.id` — running them one after another cost three
  // full round trips to render a page that needs one.
  //
  // Carpools joined via create_carpool_participation (0003_trip_request_flow.sql): a
  // trip_participants row, never a second reservation on the same vehicle/time (that
  // would collide with the double-booking constraint). trip_participants.trip_request_id
  // points at the *driver's* trip request, not the joiner's own — there's no direct FK
  // from trip_participants to reservations, so the matching reservation is fetched as a
  // second query and joined here in application code.
  const [{ data: profile }, { data: reservations }, { data: participations }, { data: carpoolRequests }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, role, gantt_zoom_preference, organization:organizations(name)")
      .eq("id", user.id)
      .single(),
    supabase
      .from("reservations")
      .select(
        `id, status, start_at, end_at, impacted_at,
       trip_request:trip_requests!inner(origin, destination, requester_id, justification),
       vehicle:vehicles(plate, name, status)`,
      )
      .eq("trip_request.requester_id", user.id)
      .order("start_at", { ascending: false }),
    supabase
      .from("trip_participants")
      .select("id, trip_request_id, joined_at, status")
      .eq("passenger_id", user.id)
      .order("joined_at", { ascending: false }),
    // Phase C5: the rider's OWN ride requests (RLS since 0062: rider / host / managers only).
    supabase
      .from("carpool_ride_requests")
      .select(
        "id, status, status_reason, requested_seats, requested_departure_at, match_additional_distance_km, match_additional_time_min, created_at, carpool_offer:carpool_offers(trip_request_id)",
      )
      .eq("rider_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const carpoolTripRequestIds = (participations ?? []).map((p) => p.trip_request_id);
  const { data: carpoolReservations } =
    carpoolTripRequestIds.length > 0
      ? await supabase
          .from("reservations")
          .select(
            `id, status, start_at, end_at, trip_request_id,
             trip_request:trip_requests(origin, destination),
             vehicle:vehicles(plate, name, status)`,
          )
          .in("trip_request_id", carpoolTripRequestIds)
      : { data: [] };

  const carpools = (participations ?? [])
    .map((p) => ({
      participantId: p.id,
      status: p.status,
      reservation: (carpoolReservations ?? []).find((r) => r.trip_request_id === p.trip_request_id),
    }))
    .filter(
      (c): c is { participantId: string; status: string; reservation: NonNullable<typeof c.reservation> } =>
        Boolean(c.reservation),
    );

  // An ACCEPTED request of the new engine also exists as an accepted trip_participants row (the
  // accept RPC writes it), so it is listed in the requests section below and NOT repeated in the
  // "Caronas" list. The Gantt keeps every carpool bar.
  const acceptedViaRequestTripIds = new Set(
    (carpoolRequests ?? [])
      .filter((r) => r.status === "ACCEPTED")
      .map((r) => r.carpool_offer?.trip_request_id)
      .filter((id): id is string => Boolean(id)),
  );
  const listedCarpools = carpools.filter((c) => !acceptedViaRequestTripIds.has(c.reservation.trip_request_id));

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";

  return (
    <AppShell
      active="trips"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={dict.trips.list.title}
      headerActions={
        <Link
          href="/trips/new"
          className="rounded-sm bg-gwm-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90"
        >
          + {dict.trips.list.newTrip}
        </Link>
      }
    >
      <div className="px-6 py-8">
      <div className="mx-auto max-w-4xl">
        {tripActionError ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-signal-red/40 bg-signal-red/10 px-4 py-3 text-sm text-signal-red"
          >
            {/* The pickup/return checklist pages redirect here with a specific reason when
                they refuse to open; anything else keeps the generic action-failed text. */}
            {tripActionError === "checklist_not_authorized"
              ? dict.reservations.checklistGuard.notAuthorized
              : tripActionError === "pickup_wrong_status"
                ? dict.reservations.checklistGuard.pickupWrongStatus
                : tripActionError === "return_wrong_status"
                  ? dict.reservations.checklistGuard.returnWrongStatus
                  : dict.trips.list.actionError}
          </div>
        ) : null}

        {carpoolActionError ? (
          <div
            role="alert"
            data-testid="carpool-action-error"
            className="mb-4 rounded-md border border-signal-red/40 bg-signal-red/10 px-4 py-3 text-sm text-signal-red"
          >
            {fillTemplate(dict.carpool.rider.actionErrorNotice, { message: carpoolErrorText(dict, carpoolActionError) })}
          </div>
        ) : null}

        {!reservations || reservations.length === 0 ? (
          <p className="text-sm text-fog-400">
            {dict.trips.list.empty}
          </p>
        ) : (
          <ReservationGantt
            bars={[
              ...reservations.map((r) => ({
                id: r.id,
                start_at: r.start_at,
                end_at: r.end_at,
                status: r.status,
                rowPlate: r.vehicle?.plate ?? "—",
                rowVehicleName: r.vehicle?.name ?? r.vehicle?.plate ?? "—",
                barLabel: r.trip_request?.destination ?? "—",
              })),
              ...carpools.map(({ reservation: r }) => ({
                id: r.id,
                start_at: r.start_at,
                end_at: r.end_at,
                status: r.status,
                rowPlate: r.vehicle?.plate ?? "—",
                rowVehicleName: r.vehicle?.name ?? r.vehicle?.plate ?? "—",
                barLabel: r.trip_request?.destination ?? "—",
                tooltipExtra: dict.trips.list.carpoolsTitle,
              })),
            ]}
            locale={locale}
            rowHeading={dict.common.vehicle}
            initialZoom={(profile?.gantt_zoom_preference as GanttZoomLevel) ?? "month"}
          />
        )}

        {carpoolRequests && carpoolRequests.length > 0 ? (
          <div className="mt-8" data-testid="my-carpool-requests">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
              {dict.carpool.rider.myRequestsTitle}
            </h2>
            <ul className="flex flex-col gap-3">
              {carpoolRequests.map((r) => {
                const reason = carpoolReasonText(dict, r.status_reason);
                const live = r.status === "PENDING" || r.status === "ACCEPTED";
                return (
                  <li
                    key={r.id}
                    data-testid="my-carpool-request"
                    data-status={r.status}
                    className="flex items-center justify-between gap-4 rounded-md border border-line-800 bg-panel-900/60 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-paper-50">
                        <span
                          data-testid="my-carpool-request-status"
                          className={`mr-2 rounded-sm border px-2 py-0.5 text-xs uppercase tracking-widest ${
                            r.status === "ACCEPTED"
                              ? "border-signal-teal/40 text-signal-teal"
                              : r.status === "PENDING"
                                ? "border-signal-blue/40 text-signal-blue"
                                : "border-signal-red/40 text-signal-red"
                          }`}
                        >
                          {carpoolStatusText(dict, r.status)}
                        </span>
                        {fillTemplate(dict.carpool.rider.requestedFor, { time: formatDateTimeShort(r.requested_departure_at, locale) })}
                      </p>
                      {r.match_additional_distance_km !== null && r.match_additional_time_min !== null ? (
                        <p className="mt-1 text-xs text-fog-600">
                          {fillTemplate(dict.carpool.rider.detourLine, {
                            km: Math.round(Number(r.match_additional_distance_km) * 10) / 10,
                            min: Math.round(Number(r.match_additional_time_min)),
                          })}
                        </p>
                      ) : null}
                      {reason && (r.status === "INVALIDATED" || r.status === "REJECTED") ? (
                        <p data-testid="my-carpool-request-reason" className="mt-1 text-xs text-fog-400 break-user-text">
                          {reason}
                        </p>
                      ) : null}
                    </div>
                    {live ? (
                      <form action={riderCancelRequest.bind(null, r.id)}>
                        <ConfirmSubmitButton
                          confirmMessage={dict.carpool.rider.cancelConfirm}
                          className="rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red"
                        >
                          {dict.carpool.rider.cancel}
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {listedCarpools.length > 0 ? (
          <div className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
              {dict.trips.list.carpoolsTitle}
            </h2>
            <ul className="flex flex-col gap-3">
              {listedCarpools.map(({ participantId, status, reservation: r }) => {
                const vehicleStatus = r.vehicle?.status;
                const canLeave =
                  r.status === "pending_approval" ||
                  (r.status === "confirmed" && vehicleStatus !== "in_use" && vehicleStatus !== "returning");
                return (
                  <li
                    key={participantId}
                    className="flex items-center justify-between rounded-md border border-line-800 bg-panel-900/60 p-4"
                  >
                    <Link href={`/reservations/${r.id}`} className="min-w-0 flex-1 hover:opacity-80">
                      <p className="text-sm text-paper-50 break-user-text">
                        {r.trip_request?.origin} → {r.trip_request?.destination}
                      </p>
                      <p className="mt-1 font-mono text-xs tabular-nums text-fog-400">
                        {r.vehicle?.plate ?? "—"} · {formatDateTime(r.start_at, locale)}
                      </p>
                      <p className="mt-1 text-xs text-fog-600">
                        {reservationStatusLabel(r.status)}
                        {status === "pending" ? (
                          <span className="ml-2 text-signal-blue">
                            · {dict.trips.list.awaitingDriverAcceptance}
                          </span>
                        ) : null}
                      </p>
                    </Link>
                    {canLeave ? (
                      <form action={leaveCarpool.bind(null, participantId)}>
                        <ConfirmSubmitButton
                          confirmMessage={dict.trips.list.confirmLeave}
                          className="rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red"
                        >
                          {dict.trips.list.leave}
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
      </div>
    </AppShell>
  );
}
