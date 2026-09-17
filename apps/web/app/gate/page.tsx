import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/formatDateTime";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { AppShell } from "../AppShell";
import { getStatusMeta } from "../dashboard/statusMeta";
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
const PICKUP_VEHICLE_STATUSES = ["reserved", "awaiting_pickup"] as const;
const RETURN_VEHICLE_STATUSES = ["in_use", "returning"] as const;

export default async function GatePage() {
  const supabase = await createSupabaseServerClient();
  const dict = await getDictionary();
  const locale = await getLocale();
  const statusMeta = getStatusMeta(dict);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";
  const isSecurity = profile?.role === "security";
  // Same redirect convention as /fleet: unauthorized roles bounce to the dashboard with
  // no error flag (there is no error-flag convention on these role gates).
  if (!profile || !(isSecurity || isFleetManager)) redirect("/dashboard");

  // Org-wide (RLS: "members read own organization reservations" is org-scoped for every
  // role), deliberately NOT narrowed to the reservations a given manager approved and not
  // date-filtered — the gate cares about the current actionable set, whatever day it
  // started on.
  const { data: reservations, error: loadError } = await supabase
    .from("reservations")
    .select(
      `id, status, start_at, end_at,
       trip_request:trip_requests(origin, destination, requester:profiles(full_name)),
       vehicle:vehicles(plate, name, status)`,
    )
    .eq("status", "confirmed")
    .order("start_at")
    .limit(100);

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
        startAt: formatDateTime(r.start_at, locale),
        statusLabel: meta?.label ?? vehicleStatus,
        statusClass: meta?.text ?? "text-fog-400",
        action: (PICKUP_VEHICLE_STATUSES as readonly string[]).includes(vehicleStatus)
          ? "pickup"
          : "return",
      };
    });

  return (
    <AppShell
      active="gate"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={dict.gate.title}
    >
      {loadError ? (
        <div
          role="alert"
          className="border-b border-signal-red/40 bg-signal-red/10 px-6 py-3 text-sm text-signal-red"
        >
          {dict.gate.loadError}
        </div>
      ) : null}

      <section className="px-6 py-6">
        <p className="mb-4 max-w-2xl text-sm text-fog-400">{dict.gate.description}</p>
        <GateList rows={rows} dict={dict} />
      </section>
    </AppShell>
  );
}
