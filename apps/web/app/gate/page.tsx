import { gateAction,loadGateChecklistStates } from "@/lib/operations/checklistState";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { automaticReleaseEnabled } from "@/lib/operations/autoReleasePolicy";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { formatDayMonthTime } from "@/lib/formatDateTime";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { FmShell } from "../carpool/FmShell";
import { getStatusMeta } from "../dashboard/statusMeta";
import "./gate.css";
import { GateList, type GateRow } from "./GateList";
import { GateResultDialog } from "./GateResultDialog";
import { getAreaText } from "@/lib/i18n/areaText";
import { gateMovementTexts } from "@/lib/i18n/areas/gateMovement";
import { nearestEventFirst } from "@/lib/operations/gateOrder";

/**
 * Portaria / gatehouse board. The `security` role is authorized end-to-end in the backend
 * to run pickup and return checklists (reservations/[id]/page.tsx treats it as
 * privileged; pickup/return actions pass p_role: "security"), but until this screen there
 * was no navigable path for a gate worker to ever reach a reservation: /trips filters by
 * `trip_request.requester_id = user.id`, which is always empty for someone who never
 * requests trips themselves.
 *
 * Scope note: reservation_status (0001_init_schema.sql) only has
 * pending_approval/confirmed/cancelled/completed — the operational phase of a trip lives
 * on `vehicles.status` (reserved → awaiting_pickup → in_use → returning). So "actionable
 * at the gate" is: reservation confirmed AND vehicle in one of those four states, the
 * same pairing /trips uses to decide its own Pickup/Return buttons.
 */
const PICKUP_VEHICLE_STATUSES = ["available", "reserved", "awaiting_pickup"] as const;
const RETURN_VEHICLE_STATUSES = ["in_use", "returning", "blocked"] as const;

export default async function GatePage({ searchParams }: { searchParams?: Promise<{ error?: string; success?: string; moved?: string }> }) {
  const query = (await searchParams) ?? {};
  const supabase = await createSupabaseServerClient();
  const dict = await getDictionary();
  const locale = await getLocale();
  const statusMeta = getStatusMeta(dict);

  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  // The gate board is org-scoped by RLS, not by anything on `profile` — so the profile
  // lookup (needed only for the nav shell and the role gate below) and the reservation
  // list are independent, and running them back-to-back cost two full round trips where
  // one suffices.
  const M = await getAreaText(gateMovementTexts);
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, full_name, role, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";
  const isSecurity = profile?.role === "security";
  // Same redirect convention as /fleet: unauthorized roles bounce to the dashboard with
  // no error flag (there is no error-flag convention on these role gates).
  if (!profile || !(isSecurity || isFleetManager)) redirect("/dashboard");

  // A reservation whose window ended without the vehicle leaving frees the vehicle (once the organization's grace period passes): checked every time the gate opens, so
  // the car does not wait for the daily routine. Best-effort: a failure here never blocks the board.
  if (automaticReleaseEnabled()) {
    try {
      await createSupabaseAdminClient().rpc("fm_release_expired_reservations", { p_organization_id: profile.organization_id });
    } catch {
      // the daily cron (/api/cron/reservation-expiry) is the fallback
    }
  }
  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - 24 * 3600 * 1000).toISOString();
  const { data: reservations, error: loadError } = await supabase
    .from("reservations")
    .select(
      `id, status, start_at, end_at, cancellation_reason,
       trip_request:trip_requests(origin, destination, requester:profiles(full_name)),
       vehicle:vehicles(plate, name, status)`,
    )
    // open reservations + the ones the automatic release cancelled in the last 24 hours (they stay on the board as "reserved and not picked up")
    .or(`status.eq.confirmed,and(status.eq.cancelled,cancellation_reason.eq.no_show_auto,cancelled_at.gte.${sinceIso})`)
    .order("start_at")
    .limit(100);

  // Org-wide (RLS: "members read own organization reservations" is org-scoped for every
  // role), deliberately NOT narrowed to the reservations a given manager approved and not
  // date-filtered — the gate cares about the current actionable set, whatever day it
  // started on. Fetched in the Promise.all above.
  const checklistStates=await loadGateChecklistStates(supabase,(reservations??[]).filter((r)=>r.status==="confirmed").map(r=>r.id));
  const listed = (reservations ?? [])
    .filter((r) => {
      if (r.status === "cancelled") return r.vehicle !== null && r.vehicle !== undefined;
      const s = r.vehicle?.status;
      return (
        s !== undefined &&
        (PICKUP_VEHICLE_STATUSES as readonly string[]).concat(RETURN_VEHICLE_STATUSES).includes(s)
      );
    })
    .map((r) => {
      const vehicleStatus = r.vehicle!.status;
      const meta = statusMeta[vehicleStatus];
      // the window ended and the vehicle never left (still reserved / waiting for pickup), or the automatic release already cancelled it
      const notPickedUp =
        r.status === "cancelled" ||
        (new Date(r.end_at).getTime() <= nowMs && (PICKUP_VEHICLE_STATUSES as readonly string[]).includes(vehicleStatus));
      const action = notPickedUp ? "waiting" : gateAction(checklistStates?.get(r.id));
      // what comes next for this reservation: once the vehicle has left that is its return, until then its departure
      const eventKind: GateRow["eventKind"] =
        !notPickedUp && (action === "return" || action === "arrival" || vehicleStatus === "in_use" || vehicleStatus === "returning") ? "return" : "departure";
      const eventIso = eventKind === "return" ? r.end_at : r.start_at;
      return {
        id: r.id,
        plate: r.vehicle?.plate ?? "—",
        vehicleName: r.vehicle?.name ?? null,
        requesterName: r.trip_request?.requester?.full_name ?? null,
        // the gate (porteiro) does not need to know where the trip goes
        route: isSecurity ? "" : `${r.trip_request?.origin ?? "—"} → ${r.trip_request?.destination ?? "—"}`,
        eventKind,
        eventAt: formatDayMonthTime(eventIso, locale),
        eventMs: new Date(eventIso).getTime(),
        statusLabel: notPickedUp ? M.notPickedUpShort : (meta?.label ?? vehicleStatus),
        statusHint: notPickedUp ? M.notPickedUp : undefined,
        statusClass: meta?.text ?? "text-fog-400",
        status: notPickedUp ? "inspection" : vehicleStatus,
        action,
        notPickedUp,
      };
    });
  const rows: GateRow[] = nearestEventFirst(listed, nowMs).map(({ eventMs: _eventMs, ...row }) => row);

  const g = dict.ops.gate;
  // the reservation query is .limit(100): say so instead of showing a silently truncated count
  const capped = (reservations?.length ?? 0) >= 100;

  return (
    <FmShell
      active="gate"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={g.title}
      subtitle={g.subtitle}
      legacy
      wide
    >
      {loadError || checklistStates===null ? (
        <div role="alert" className="fm-banner fm-banner-danger" style={{ marginTop: 0, marginBottom: 16 }}>
          {dict.gate.loadError}
        </div>
      ) : null}

      {query.error ? (
        <GateResultDialog tone="error" title={M.errorTitle} message={(dict.opsShell.errors as Record<string, string>)[query.error] ?? dict.opsShell.genericError} okLabel={M.ok} />
      ) : query.success && (query.moved === "departure" || query.moved === "arrival" || query.moved === "denied") ? (
        <GateResultDialog
          tone="ok"
          title={query.moved === "departure" ? M.resultDeparture : query.moved === "arrival" ? M.resultArrival : M.resultDenied}
          message={M.managerNotified}
          okLabel={M.ok}
        />
      ) : null}

      {capped ? (
        <p role="status" className="fm-banner" data-testid="gate-cap-note" style={{ marginTop: 0, marginBottom: 16 }}>{g.capNote}</p>
      ) : null}

      <GateList rows={rows} dict={dict} T={M} canRecordMovement={isSecurity} />
    </FmShell>
  );
}
