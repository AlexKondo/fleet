import { gateAction,loadGateChecklistStates } from "@/lib/operations/checklistState";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { formatDateTimeShort } from "@/lib/formatDateTime";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { FmShell } from "../carpool/FmShell";
import { FmArrowInIcon, FmArrowOutIcon, FmCarIcon } from "../fmIcons";
import { getStatusMeta } from "../dashboard/statusMeta";
import "./gate.css";
import { GateList, type GateRow } from "./GateList";

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

export default async function GatePage() {
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
  const [{ data: profile }, { data: reservations, error: loadError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, role, organization:organizations(name)")
      .eq("id", user.id)
      .single(),
    supabase
      .from("reservations")
      .select(
        `id, status, start_at, end_at,
       trip_request:trip_requests(origin, destination, requester:profiles(full_name)),
       vehicle:vehicles(plate, name, status)`,
      )
      .eq("status", "confirmed")
      .order("start_at")
      .limit(100),
  ]);

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";
  const isSecurity = profile?.role === "security";
  // Same redirect convention as /fleet: unauthorized roles bounce to the dashboard with
  // no error flag (there is no error-flag convention on these role gates).
  if (!profile || !(isSecurity || isFleetManager)) redirect("/dashboard");

  // Org-wide (RLS: "members read own organization reservations" is org-scoped for every
  // role), deliberately NOT narrowed to the reservations a given manager approved and not
  // date-filtered — the gate cares about the current actionable set, whatever day it
  // started on. Fetched in the Promise.all above.
  const checklistStates=await loadGateChecklistStates(supabase,(reservations??[]).map(r=>r.id));
  const rows: GateRow[] = (reservations ?? [])
    .filter((r) => {
      const s = r.vehicle?.status;
      return (
        s !== undefined &&
        (PICKUP_VEHICLE_STATUSES as readonly string[]).concat(RETURN_VEHICLE_STATUSES).includes(s)
      );
    })
    .map((r) => {
      const vehicleStatus = r.vehicle!.status;
      const meta = statusMeta[vehicleStatus];
      return {
        id: r.id,
        plate: r.vehicle?.plate ?? "—",
        vehicleName: r.vehicle?.name ?? null,
        requesterName: r.trip_request?.requester?.full_name ?? null,
        route: `${r.trip_request?.origin ?? "—"} → ${r.trip_request?.destination ?? "—"}`,
        startAt: formatDateTimeShort(r.start_at, locale),
        statusLabel: meta?.label ?? vehicleStatus,
        statusClass: meta?.text ?? "text-fog-400",
        status: vehicleStatus,
        action: gateAction(checklistStates?.get(r.id)),
      };
    });

  const g = dict.ops.gate;
  const pickupCount = rows.filter((r) => r.action === "pickup").length;
  // distinct VEHICLES (a vehicle can have more than one confirmed reservation row in the list)
  const inUseCount = new Set(rows.filter((r) => r.status === "in_use").map((r) => r.plate)).size;
  const returningCount = new Set(rows.filter((r) => r.status === "returning").map((r) => r.plate)).size;
  // the reservation query is .limit(100): say so instead of showing a silently truncated count
  const capped = (reservations?.length ?? 0) >= 100;
  const plus = capped ? "+" : "";

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

      <section className="fm-kpis" aria-label={g.kpisLabel} data-testid="gate-kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div className="fm-kpi" data-testid="gate-kpi-pickup">
          <span className="fm-kpi-icon"><FmArrowOutIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value">{pickupCount}{plus}</p>
            <p className="fm-kpi-label">{g.kpiPickup}</p>
          </div>
        </div>
        <div className="fm-kpi" data-testid="gate-kpi-inuse">
          <span className="fm-kpi-icon" data-tone="ok"><FmCarIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value">{inUseCount}{plus}</p>
            <p className="fm-kpi-label">{g.kpiInUse}</p>
          </div>
        </div>
        <div className="fm-kpi" data-testid="gate-kpi-returning">
          <span className="fm-kpi-icon" data-tone="violet"><FmArrowInIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value">{returningCount}{plus}</p>
            <p className="fm-kpi-label">{g.kpiReturning}</p>
          </div>
        </div>
      </section>

      {capped ? (
        <p role="status" className="fm-banner" data-testid="gate-cap-note" style={{ marginTop: 0, marginBottom: 16 }}>{g.capNote}</p>
      ) : null}

      <GateList rows={rows} dict={dict} capped={capped} />
    </FmShell>
  );
}
