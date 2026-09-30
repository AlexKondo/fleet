import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { formatDateTime } from "@/lib/formatDateTime";
import { AppShell } from "../AppShell";
import { leaveCarpool } from "./actions";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { ReservationGantt } from "../ReservationGantt";
import type { GanttZoomLevel } from "../ganttZoomActions";

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ tripActionError?: string }>;
}) {
  const { tripActionError } = await searchParams;
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
  const [{ data: profile }, { data: reservations }, { data: participations }] = await Promise.all([
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

        {carpools.length > 0 ? (
          <div className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
              {dict.trips.list.carpoolsTitle}
            </h2>
            <ul className="flex flex-col gap-3">
              {carpools.map(({ participantId, status, reservation: r }) => {
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
                      <p className="text-sm text-paper-50">
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
