import { loadMyChecklistStates } from "@/lib/operations/checklistState";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { formatDateTimeShort } from "@/lib/formatDateTime";
import { FmShell } from "../carpool/FmShell";
import { leaveCarpool } from "./actions";
import { riderCancelRequest } from "../carpool/formActions";
import {
  carpoolErrorText,
  carpoolReasonText,
  carpoolStatusText,
  fillTemplate,
} from "@/lib/carpool/errorText";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { ClientGantt as ReservationGantt } from "./ClientGantt";
import type { GanttZoomLevel } from "../ganttZoomActions";
import { getStatusMeta } from "../dashboard/statusMeta";
import { FmCarIcon, FmChevronIcon, FmPlusIcon, FmUsersIcon } from "../fmIcons";
import "./trips.css";

const TABS = [
  "all",
  "upcoming",
  "active",
  "carpools",
  "done",
  "cancelled",
] as const;
type Tab = (typeof TABS)[number];

const TZ = "America/Sao_Paulo";
function dateBlock(iso: string, locale: string) {
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) =>
    d.toLocaleString(locale, { timeZone: TZ, ...o }).replace(".", "");
  return {
    day: f({ day: "2-digit" }),
    month: f({ month: "short" }),
    weekday: f({ weekday: "short" }),
  };
}
function timeOf(iso: string, locale: string) {
  return new Date(iso).toLocaleTimeString(locale, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function TripsWorkspace({
  searchParams,
  carpoolOnly = false,
}: {
  searchParams: Promise<{
    tripActionError?: string;
    carpoolActionError?: string;
    tab?: string;
  }>;
  carpoolOnly?: boolean;
}) {
  const {
    tripActionError,
    carpoolActionError,
    tab: requestedTab,
  } = await searchParams;
  const tabParam = carpoolOnly ? "carpools" : requestedTab;
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as Tab)
    : "all";
  const dict = await getDictionary();
  const locale = await getLocale();
  const m = dict.trips.minhas;
  const reservationStatusLabel = (status: string): string =>
    (dict.trips.statuses as Record<string, string>)[status] ?? status;
  const vehicleStatusMeta = getStatusMeta(dict);
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
  const [
    { data: profile },
    { data: reservations },
    { data: participations },
    { data: carpoolRequests },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "full_name, role, gantt_zoom_preference, organization:organizations(name)",
      )
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
      .select("id, trip_request_id, joined_at, status,left_at")
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

  const checklistStates=await loadMyChecklistStates(supabase,(reservations??[]).filter(r=>r.status==="confirmed").map(r=>r.id));
  const carpoolTripRequestIds = (participations ?? []).map(
    (p) => p.trip_request_id,
  );
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
      leftAt:p.left_at,
      reservation: (carpoolReservations ?? []).find(
        (r) => r.trip_request_id === p.trip_request_id,
      ),
    }))
    .filter(
      (
        c,
      ): c is {
        participantId: string;
        status: string;
        leftAt:string|null;
        reservation: NonNullable<typeof c.reservation>;
      } => Boolean(c.reservation),
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
  const listedCarpools = carpools.filter(
    (c) => !acceptedViaRequestTripIds.has(c.reservation.trip_request_id),
  );

  const isFleetManager =
    profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";

  // ---- grouping for the tabs (all derived from the rows above) ----
  const all = reservations ?? [];
  const isActive = (r: (typeof all)[number]) =>
    r.status === "confirmed" &&
    (r.vehicle?.status === "in_use" || r.vehicle?.status === "returning");
  const activeList = all
    .filter(isActive)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const upcomingList = all
    .filter(
      (r) =>
        (r.status === "pending_approval" || r.status === "confirmed") &&
        !isActive(r),
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const doneList = all.filter((r) => r.status === "completed");
  const cancelledList = all.filter((r) => r.status === "cancelled");
  const requests = carpoolRequests ?? [];
  const carpoolCount = requests.length + listedCarpools.length;
  const total = all.length + carpoolCount;
  const historyList = [...doneList, ...cancelledList].sort((a, b) =>
    b.start_at.localeCompare(a.start_at),
  );

  const counts: Record<Tab, number> = {
    all: total,
    upcoming: upcomingList.length,
    active: activeList.length,
    carpools: carpoolCount,
    done: doneList.length,
    cancelled: cancelledList.length,
  };
  const tabLabels: Record<Tab, string> = {
    all: m.tabAll,
    upcoming: m.tabUpcoming,
    active: m.tabActive,
    carpools: m.tabCarpools,
    done: m.tabDone,
    cancelled: m.tabCancelled,
  };

  const show = (section: "active" | "upcoming" | "carpools" | "history") => {
    if (tab === "all") return true;
    if (section === "history") return tab === "done" || tab === "cancelled";
    return tab === section;
  };
  const historyShown =
    tab === "done"
      ? doneList
      : tab === "cancelled"
        ? cancelledList
        : historyList;

  type Row = (typeof all)[number];
  const tone = (s: string) =>
    s === "confirmed"
      ? "ok"
      : s === "pending_approval"
        ? "warn"
        : s === "cancelled"
          ? "bad"
          : "neutral";

  const card = (r: Row) => {
    const d = dateBlock(r.start_at, locale);
    const vs = r.vehicle?.status;
    const canPickup=checklistStates?.get(r.id)?.can_pickup ?? false;
    const canReturn=checklistStates?.get(r.id)?.can_return ?? false;
    return (
      <li
        key={r.id}
        className="fm-card tp-card"
        data-testid="trip-card"
        data-status={r.status}
      >
        <div className="tp-date" aria-hidden="true">
          <strong>{d.day}</strong>
          <span>{d.month}</span>
          <small>{d.weekday}</small>
        </div>
        <div className="tp-main">
          <p className="tp-title">
            <span className="tp-kind">
              <FmCarIcon />
              {m.kindVehicle}
            </span>
            <strong>{r.vehicle?.name ?? r.vehicle?.plate ?? "—"}</strong>
            <span className="tp-plate">{r.vehicle?.plate ?? "—"}</span>
          </p>
          <p className="tp-route break-user-text">
            {r.trip_request?.origin} → {r.trip_request?.destination}
          </p>
          <p className="tp-meta">
            {formatDateTimeShort(r.start_at, locale)} →{" "}
            {timeOf(r.end_at, locale)}
          </p>
        </div>
        <div className="tp-side">
          <span className="fm-pill" data-tone={tone(r.status)}>
            {reservationStatusLabel(r.status)}
          </span>
          {isActive(r) && vs ? (
            <span className="fm-pill" data-tone="info">
              {vehicleStatusMeta[vs]?.label ?? vs}
            </span>
          ) : null}
        </div>
        <div className="tp-actions">
          {canPickup ? (
            <Link
              href={`/reservations/${r.id}/pickup`}
              className="fm-btn fm-btn-primary"
            >
              {dict.trips.list.startPickup}
            </Link>
          ) : null}
          {canReturn ? (
            <Link
              href={`/reservations/${r.id}/return`}
              className="fm-btn fm-btn-primary"
            >
              {dict.trips.list.registerReturn}
            </Link>
          ) : null}
          <Link href={`/reservations/${r.id}`} className="fm-btn fm-btn-ghost">
            {m.viewDetails} <FmChevronIcon />
          </Link>
        </div>
      </li>
    );
  };

  const section = (id: string, title: string, rows: Row[], testid: string) =>
    rows.length === 0 ? null : (
      <section className="tp-section" aria-labelledby={id} data-testid={testid}>
        <h2 id={id} className="fm-h2">
          {title}
        </h2>
        <ul className="fm-list">{rows.map(card)}</ul>
      </section>
    );

  const showCarpools =
    show("carpools") && (requests.length > 0 || listedCarpools.length > 0);
  const visibleCount =
    (show("active") ? activeList.length : 0) +
    (show("upcoming") ? upcomingList.length : 0) +
    (show("history") ? historyShown.length : 0) +
    (showCarpools ? 1 : 0);

  return (
    <FmShell
      active={carpoolOnly ? "myCarpools" : "trips"}
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
    >
      <div className="tp">
        <div className="tp-head">
          <div>
            <h1 className="fm-title">{carpoolOnly ? dict.dashboard.home.carpoolTitle : m.title}</h1>
            {carpoolOnly ? null : <p className="fm-subtitle">{m.subtitle}</p>}
          </div>
          <Link href="/trips/new" className="fm-btn fm-btn-primary tp-new">
            <FmPlusIcon /> {m.newReservation}
          </Link>
        </div>

        {checklistStates===null ? <p role="alert" className="fm-banner fm-banner-danger">{dict.ops.gate.checklistUnavailable}</p> : null}
        {tripActionError ? (
          <div role="alert" className="fm-banner fm-banner-danger tp-banner">
            {/* The pickup/return checklist pages redirect here with a specific reason when
                they refuse to open; anything else keeps the generic action-failed text. */}
            {tripActionError === "checklist_unavailable" ? dict.ops.gate.checklistUnavailable : tripActionError === "checklist_not_authorized"
              ? dict.reservations.checklistGuard.notAuthorized
              : tripActionError === "pickup_wrong_status"
                ? dict.reservations.checklistGuard.pickupWrongStatus
                : tripActionError === "return_wrong_status"
                  ? dict.reservations.checklistGuard.returnWrongStatus
                  : tripActionError === "cancel_blocked_operation_started"
                    ? dict.rpcErrors.cancelBlockedOperationStarted
                    : dict.trips.list.actionError}
          </div>
        ) : null}

        {carpoolActionError ? (
          <div
            role="alert"
            data-testid="carpool-action-error"
            className="fm-banner fm-banner-danger tp-banner"
          >
            {fillTemplate(dict.carpool.rider.actionErrorNotice, {
              message: carpoolErrorText(dict, carpoolActionError),
            })}
          </div>
        ) : null}

        <nav
          className="tp-tabs"
          aria-label={m.tabsLabel}
          data-testid="trips-tabs"
        >
          {(carpoolOnly ? (["carpools"] as const) : TABS).map((k) => (
            <Link
              key={k}
              href={k === "all" ? "/trips" : `/trips?tab=${k}`}
              className="tp-tab"
              aria-current={k === tab ? "page" : undefined}
              data-tab={k}
            >
              {tabLabels[k]} <span className="tp-count">({counts[k]})</span>
            </Link>
          ))}
        </nav>

        {total === 0 ? (
          <div className="fm-card tp-empty" data-testid="trips-empty">
            <p>{dict.trips.list.empty}</p>
            <Link href="/trips/new" className="fm-btn fm-btn-primary">
              {m.newReservation}
            </Link>
          </div>
        ) : visibleCount === 0 ? (
          <p className="fm-card tp-empty" data-testid="trips-tab-empty">
            {m.tabEmpty}
          </p>
        ) : null}

        {show("active")
          ? section("tp-active", m.activeTitle, activeList, "trips-active")
          : null}
        {show("upcoming")
          ? section(
              "tp-upcoming",
              m.upcomingTitle,
              upcomingList,
              "trips-upcoming",
            )
          : null}

        {showCarpools && requests.length > 0 ? (
          <section
            className="tp-section"
            aria-labelledby="tp-requests"
            data-testid="my-carpool-requests"
          >
            <h2 id="tp-requests" className="fm-h2">
              {dict.carpool.rider.myRequestsTitle}
            </h2>
            <ul className="fm-list">
              {requests.map((r) => {
                const reason = carpoolReasonText(dict, r.status_reason);
                const live = r.status === "PENDING" || r.status === "ACCEPTED";
                return (
                  <li
                    key={r.id}
                    data-testid="my-carpool-request"
                    data-status={r.status}
                    className="fm-card tp-request"
                  >
                    <span className="tp-kind-icon">
                      <FmUsersIcon />
                    </span>
                    <div className="tp-main">
                      <p className="tp-title">
                        <span
                          data-testid="my-carpool-request-status"
                          className="fm-pill"
                          data-tone={
                            r.status === "ACCEPTED"
                              ? "ok"
                              : r.status === "PENDING"
                                ? "info"
                                : "bad"
                          }
                        >
                          {carpoolStatusText(dict, r.status)}
                        </span>
                        <span>
                          {fillTemplate(dict.carpool.rider.requestedFor, {
                            time: formatDateTimeShort(
                              r.requested_departure_at,
                              locale,
                            ),
                          })}
                        </span>
                      </p>
                      {r.match_additional_distance_km !== null &&
                      r.match_additional_time_min !== null ? (
                        <p className="tp-meta">
                          {fillTemplate(dict.carpool.rider.detourLine, {
                            km:
                              Math.round(
                                Number(r.match_additional_distance_km) * 10,
                              ) / 10,
                            min: Math.round(
                              Number(r.match_additional_time_min),
                            ),
                          })}
                        </p>
                      ) : null}
                      {reason &&
                      (r.status === "INVALIDATED" ||
                        r.status === "REJECTED") ? (
                        <p
                          data-testid="my-carpool-request-reason"
                          className="tp-meta break-user-text"
                        >
                          {reason}
                        </p>
                      ) : null}
                    </div>
                    {live ? (
                      <form
                        action={riderCancelRequest.bind(null, r.id)}
                        className="tp-actions"
                      >
                        <ConfirmSubmitButton
                          confirmMessage={dict.carpool.rider.cancelConfirm}
                          className="fm-btn fm-btn-danger"
                        >
                          {dict.carpool.rider.cancel}
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {showCarpools && listedCarpools.length > 0 ? (
          <section
            className="tp-section"
            aria-labelledby="tp-carpools"
            data-testid="trips-carpools"
          >
            <h2 id="tp-carpools" className="fm-h2">
              {dict.trips.list.carpoolsTitle}
            </h2>
            <ul className="fm-list">
              {listedCarpools.map(
                ({ participantId, status,leftAt, reservation: r }) => {
                  const vehicleStatus = r.vehicle?.status;
                  const canLeave =
                    !leftAt && status!=="rejected" && (r.status === "pending_approval" ||
                    (r.status === "confirmed" &&
                      vehicleStatus !== "in_use" &&
                      vehicleStatus !== "returning"));
                  return (
                    <li key={participantId} className="fm-card tp-request">
                      <span className="tp-kind-icon">
                        <FmUsersIcon />
                      </span>
                      <Link
                        href={`/reservations/${r.id}`}
                        className="tp-main tp-link"
                      >
                        <p className="tp-title break-user-text">
                          {r.trip_request?.origin} →{" "}
                          {r.trip_request?.destination}
                        </p>
                        <p className="tp-meta">
                          {r.vehicle?.plate ?? "—"} ·{" "}
                          {formatDateTimeShort(r.start_at, locale)}
                        </p>
                        <p className="tp-meta">
                          {leftAt?"Cancelada pelo passageiro":reservationStatusLabel(r.status)}
                          {status === "pending" ? (
                            <> · {dict.trips.list.awaitingDriverAcceptance}</>
                          ) : null}
                        </p>
                      </Link>
                      {canLeave ? (
                        <form
                          action={leaveCarpool.bind(null, participantId)}
                          className="tp-actions"
                        >
                          <ConfirmSubmitButton
                            confirmMessage={dict.trips.list.confirmLeave}
                            className="fm-btn fm-btn-danger"
                          >
                            {dict.trips.list.leave}
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
                    </li>
                  );
                },
              )}
            </ul>
          </section>
        ) : null}

        {show("history")
          ? section("tp-history", m.historyTitle, historyShown, "trips-history")
          : null}

        {tab === "all" && all.length > 0 ? (
          <section
            className="tp-section"
            aria-labelledby="tp-schedule"
            data-testid="trips-schedule"
          >
            <h2 id="tp-schedule" className="fm-h2">
              {m.scheduleTitle}
            </h2>
            <div className="fm-card tp-gantt">
              <ReservationGantt
                bars={[
                  ...all.map((r) => ({
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
                initialZoom={
                  (profile?.gantt_zoom_preference as GanttZoomLevel) ?? "month"
                }
              />
            </div>
          </section>
        ) : null}
      </div>
    </FmShell>
  );
}
