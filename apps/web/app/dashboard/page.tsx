import Link from "next/link";
import { redirect } from "next/navigation";
import { assessVehicleReadiness } from "@fleet/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { toDomainVehicle, VEHICLE_DOMAIN_COLUMNS } from "@/lib/domain/mappers";
import { formatDateTimeShort } from "@/lib/formatDateTime";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { FmShell } from "../carpool/FmShell";
import { FmAlertIcon, FmCalendarIcon, FmCarIcon, FmCheckIcon, FmUsersIcon } from "../fmIcons";
import { getAttentionLabels, getStatusMeta } from "./statusMeta";
import { EnergyGauge } from "./EnergyGauge";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";
import { BlockVehicleForm } from "../BlockVehicleForm";
import { StatusBadge } from "../ui/StatusBadge";
import { RevealAction } from "../ui/RevealAction";
import { EmployeeHome } from "./EmployeeHome";
import { ReservationGantt } from "../ReservationGantt";
import type { GanttZoomLevel } from "../ganttZoomActions";
import {
  approveReservation,
  blockVehicle,
  cancelReservation,
  cancelWorkflowTask,
  claimWorkflowTask,
  completeWorkflowTask,
  swapVehicle,
  transferReservation,
  unblockVehicle,
} from "./actions";

/** Long free-text (justification, task notes) shown inline — full text stays in `title`. */
function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fleetActionError?: string; actionSuccess?: string; myTasks?: string }>;
}) {
  const { fleetActionError, actionSuccess, myTasks } = await searchParams;
  const onlyMyTasks = myTasks === "1";
  const locale = await getLocale();
  const dict = await getDictionary();
  const t = dict.dashboard;
  const cc = dict.ops.cc;
  const statusMeta = getStatusMeta(dict);
  const attentionLabels = getAttentionLabels(dict);
  const workflowTaskLabels: Record<string, string> = t.tasks.types;
  const supabase = await createSupabaseServerClient();

  const user = await getCurrentUser(supabase);
  if (!user) {
    redirect("/login");
  }

  // profile and vehicles don't depend on each other — fetching them sequentially was
  // paying for two full network round-trips back-to-back on every dashboard load for no
  // reason (this page routinely made 6 sequential Supabase calls in total).
  const [{ data: profile }, { data: vehicleRows, error: vehiclesError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, role, organization_id, gantt_zoom_preference, organization:organizations(name)")
      .eq("id", user.id)
      .single(),
    supabase
      .from("vehicles")
      // Explicit column list rather than `*`: the readiness assessment needs exactly
      // VEHICLE_DOMAIN_COLUMNS, and the only other `vehicles` column this page renders is
      // `color` (the swap-vehicle <option> label). created_at/updated_at/name/
      // photo_storage_path/pre_block_status were being shipped for every vehicle in the
      // fleet on every dashboard load and read by nothing.
      .select(
        `${VEHICLE_DOMAIN_COLUMNS}, color,
         category:vehicle_categories(name, energy_type),
         current_location:vehicle_locations!vehicles_current_location_id_fkey(name)`,
      ).is("archived_at",null)
      .order("plate"),
  ]);

  const vehicles = vehicleRows ?? [];
  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";
  const canManageTasks = isFleetManager || profile?.role === "maintenance_operator";

  const vehiclesWithAttention = vehicles.map((row) => ({
    row,
    attention: assessVehicleReadiness(toDomainVehicle(row, row.category?.energy_type ?? "ICE")),
  }));

  // SCR-USR-001: an employee gets the FleetMind v2.0 Home (scoped theme). Every other role keeps the screen below
  // unchanged (managers/security/admin are restyled separately); nothing a role could do here is removed.
  if (profile?.role === "employee") {
    return (
      <EmployeeHome
        userId={user.id}
        userName={profile.full_name ?? user.email ?? "—"}
        orgName={profile.organization?.name ?? "—"}
        dict={dict}
        locale={locale}
        vehicles={vehiclesWithAttention}
        vehiclesError={Boolean(vehiclesError)}
        statusMeta={statusMeta}
        attentionLabels={attentionLabels}
        fleetActionError={Boolean(fleetActionError)}
        actionSuccess={Boolean(actionSuccess)}
      />
    );
  }

  // Grouped by reason -> which specific vehicles, not just a bare count — a fleet manager
  // seeing "1 Energia baixa" still had to scan every card below to find which one; each
  // plate here links straight to its card instead.
  const vehiclesByAttentionReason = vehiclesWithAttention.reduce<Record<string, { id: string; plate: string }[]>>(
    (acc, { row, attention }) => {
      for (const reason of attention) {
        (acc[reason] ??= []).push({ id: row.id, plate: row.plate });
      }
      return acc;
    },
    {},
  );

  // These four are independent of each other (and of the two queries above) — same
  // parallelization reasoning.
  const [
    { data: pendingReservations },
    { data: openTasks },
    { data: activeReservations },
    { data: orgProfiles },
  ] = await Promise.all([
    isFleetManager
      ? supabase
          .from("reservations")
          .select(
            `id, start_at, end_at,
             trip_request:trip_requests(origin, destination, passenger_count, justification, requester:profiles(full_name)),
             vehicle:vehicles(plate, status)`,
          )
          .eq("status", "pending_approval")
          .order("start_at")
          .limit(50)
      : Promise.resolve({ data: [] as never[] }),
    canManageTasks
      ? (() => {
          // "Minhas tarefas" = mine or still up for grabs; an operator filtering the queue
          // down still needs to see the unassigned pool, otherwise the filter hides
          // exactly the tasks they're supposed to claim.
          const query = supabase
            .from("workflow_tasks")
            .select(
              `id, type, notes, created_at, priority, assigned_to,
               assignee:profiles!workflow_tasks_assigned_to_fkey(full_name),
               vehicle:vehicles(plate)`,
            )
            .eq("status", "open");
          return (
            onlyMyTasks ? query.or(`assigned_to.eq.${user.id},assigned_to.is.null`) : query
          )
            .order("created_at")
            .limit(50);
        })()
      : Promise.resolve({ data: [] as never[] }),
    // Backing data for the swap-vehicle / transfer-reservation actions below (§5
    // "Substituir veículos" / "Transferir reservas"): every reservation still active
    // enough to be worth reassigning, plus the org's member list to transfer onto.
    isFleetManager
      ? supabase
          .from("reservations")
          .select(
            `id, start_at, end_at, status, impacted_at,
             vehicle:vehicles(id, plate, name),
             trip_request:trip_requests(origin, destination, requester_id, requester:profiles(full_name))`,
          )
          .in("status", ["pending_approval", "confirmed"])
          .order("start_at")
          .limit(50)
      : Promise.resolve({ data: [] as never[] }),
    isFleetManager
      ? supabase.from("profiles").select("id, full_name").order("full_name")
      : Promise.resolve({ data: [] as never[] }),
  ]);

  // The reservations table's exclusion constraint (0001_init_schema.sql) only stops the
  // SAME vehicle from double-booking — nothing stops the SAME requester from ending up
  // with two overlapping reservations on two DIFFERENT vehicles (they obviously can't be
  // in both places at once). Flagged here for the fleet manager rather than silently
  // allowed, since neither create_vehicle_reservation nor this dashboard currently checks
  // across a requester's own reservations.
  const conflictedReservationIds = new Set<string>();
  const activeReservationsByRequester = new Map<string, NonNullable<typeof activeReservations>[0][]>();
  for (const r of activeReservations ?? []) {
    const requesterId = r.trip_request?.requester_id;
    if (!requesterId) continue;
    const bucket = activeReservationsByRequester.get(requesterId) ?? [];
    bucket.push(r);
    activeReservationsByRequester.set(requesterId, bucket);
  }
  for (const bucket of activeReservationsByRequester.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        if (a.start_at < b.end_at && b.start_at < a.end_at) {
          conflictedReservationIds.add(a.id);
          conflictedReservationIds.add(b.id);
        }
      }
    }
  }

  // Command Center 360 (SCR-FM-001) numbers: only counts of rows this page already loaded.
  const statusCounts = new Map<string, number>();
  for (const { row } of vehiclesWithAttention) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  const attentionVehicleCount = vehiclesWithAttention.filter((v) => v.attention.length > 0).length;
  const LIST_CAP = 50; // the queries above are .limit(50): show "50+" instead of a wrong exact count
  const capped = (n: number) => (n >= LIST_CAP ? `${LIST_CAP}+` : String(n));

  return (
    <FmShell
      active="dashboard"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={cc.title}
      subtitle={cc.subtitle}
      legacy
      wide
    >
      {isFleetManager ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <div><strong className="text-slate-900">Fleet Command Center 360°</strong>
            <p className="text-sm text-slate-700">Indicadores por unidade, distribuição operacional e veículos que exigem atenção.</p>
          </div>
          <Link href="/dashboard/command-center" className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800">Abrir Central de Comando →</Link>
        </div>
      ) : null}
      {fleetActionError ? (
        <div
          role="alert"
          className="fm-banner fm-banner-danger cc-banner"
        >
          <span>{t.actionError}</span>
          <Link href="/dashboard" className="fm-link">
            {t.dismissBanner}
          </Link>
        </div>
      ) : null}

      {/* Success counterpart of the error banner above — same weight, same shape, just the
          positive status token, so a completed action is acknowledged instead of silent. */}
      {actionSuccess ? (
        <div
          role="status"
          className="fm-banner cc-banner cc-banner-ok"
        >
          <span>{t.actionSuccess}</span>
          <Link
            href={onlyMyTasks ? "/dashboard?myTasks=1" : "/dashboard"}
            className="fm-link"
          >
            {t.dismissBanner}
          </Link>
        </div>
      ) : null}

      {/* A failed fleet query must never be reported as a real zero in the command center. */}
      {vehiclesError ? (
        <div role="alert" className="fm-banner fm-banner-danger cc-banner" data-testid="cc-fleet-load-error">
          {t.vehicles.loadError}
        </div>
      ) : null}

      <section className="fm-kpis" aria-label={cc.kpisLabel} data-testid="cc-kpis">
        <div className="fm-kpi fm-kpi-wide" data-testid="cc-kpi-vehicles">
          <span className="fm-kpi-icon"><FmCarIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value" data-testid="cc-vehicles-value">{vehiclesError ? "—" : vehicles.length}</p>
            <p className="fm-kpi-label">{cc.kpiVehicles}</p>
          </div>
          {!vehiclesError && vehicles.length > 0 ? (
            <>
              <div className="fm-seg" role="img" aria-label={cc.kpiVehiclesBar}>
                {[...statusCounts.entries()].map(([status, n]) => (
                  <span key={status} data-s={status} style={{ flexGrow: n }} />
                ))}
              </div>
              <ul className="fm-legend">
                {[...statusCounts.entries()].map(([status, n]) => (
                  <li key={status}>
                    <span className="fm-dot" data-s={status} aria-hidden="true" />
                    <span>{statusMeta[status as keyof typeof statusMeta]?.label ?? status}</span>
                    <strong>{n}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        {isFleetManager ? (
          <a href="#pending-approvals" className="fm-kpi" data-testid="cc-kpi-pending">
            <span className="fm-kpi-icon" data-tone="warn"><FmCheckIcon /></span>
            <div className="fm-kpi-body">
              <p className="fm-kpi-value">{capped(pendingReservations?.length ?? 0)}</p>
              <p className="fm-kpi-label">{cc.kpiPending}</p>
              {(pendingReservations?.length ?? 0) >= LIST_CAP ? <p className="fm-kpi-sub">{cc.kpiCapped.replace("{count}", String(LIST_CAP))}</p> : null}
            </div>
          </a>
        ) : null}
        {isFleetManager ? (
          <a href="#active-reservations" className="fm-kpi" data-testid="cc-kpi-active">
            <span className="fm-kpi-icon" data-tone="info"><FmCalendarIcon /></span>
            <div className="fm-kpi-body">
              <p className="fm-kpi-value">{capped(activeReservations?.length ?? 0)}</p>
              <p className="fm-kpi-label">{cc.kpiActive}</p>
              {(activeReservations?.length ?? 0) >= LIST_CAP ? <p className="fm-kpi-sub">{cc.kpiCapped.replace("{count}", String(LIST_CAP))}</p> : null}
              {conflictedReservationIds.size > 0 ? (
                <p className="fm-kpi-sub fm-kpi-sub-bad">{cc.kpiConflicts.replace("{count}", String(conflictedReservationIds.size))}</p>
              ) : null}
            </div>
          </a>
        ) : null}
        {canManageTasks ? (
          <a href="#open-tasks" className="fm-kpi" data-testid="cc-kpi-tasks">
            <span className="fm-kpi-icon" data-tone="info"><FmUsersIcon /></span>
            <div className="fm-kpi-body">
              <p className="fm-kpi-value">{capped(openTasks?.length ?? 0)}</p>
              <p className="fm-kpi-label">{onlyMyTasks ? cc.kpiTasksMine : cc.kpiTasks}</p>
              {(openTasks?.length ?? 0) >= LIST_CAP ? <p className="fm-kpi-sub">{cc.kpiCapped.replace("{count}", String(LIST_CAP))}</p> : null}
            </div>
          </a>
        ) : null}
        <a href="#attention" className="fm-kpi" data-testid="cc-kpi-attention">
          <span className="fm-kpi-icon" data-tone={attentionVehicleCount > 0 ? "bad" : "ok"}><FmAlertIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value" data-testid="cc-attention-value">{vehiclesError ? "—" : attentionVehicleCount}</p>
            <p className="fm-kpi-label">{cc.kpiAttention}</p>
          </div>
        </a>
      </section>

      <div className={isFleetManager ? "cc-grid" : "cc-grid cc-grid-solo"}>
      <section className="fm-panel cc-attention" id="attention">
        <h2 className="fm-h2">
          {t.attention.heading}
        </h2>
        {vehiclesError ? (
          <p role="status" className="text-sm text-signal-red">{t.vehicles.loadError}</p>
        ) : Object.keys(vehiclesByAttentionReason).length === 0 ? (
          <p className="text-sm text-fog-400">{t.attention.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {Object.entries(vehiclesByAttentionReason).map(([reason, vehiclesForReason]) => (
              <li key={reason} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-mono text-gwm-accent">{vehiclesForReason.length}</span>
                <span className="text-fog-400">{attentionLabels[reason] ?? reason}:</span>
                {vehiclesForReason.map((v, i) => (
                  <span key={v.id} className="font-mono text-xs text-fog-400">
                    <a href={`#vehicle-${v.id}`} className="text-gwm-accent underline-offset-2 hover:underline">
                      {v.plate}
                    </a>
                    {i < vehiclesForReason.length - 1 ? "," : ""}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isFleetManager ? (
        <section className="fm-panel cc-pending" id="pending-approvals">
          <h2 className="fm-h2">
            {t.pendingReservations.heading}
          </h2>
          {!pendingReservations || pendingReservations.length === 0 ? (
            <p className="text-sm text-fog-400">{t.pendingReservations.empty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pendingReservations.map((r) => {
                const requesterName =
                  r.trip_request?.requester?.full_name ?? t.activeReservations.unknownRequester;
                const justification = r.trip_request?.justification?.trim();
                // Mirrors approve_reservation's own guard (0024_time_aware_approval_and_pickup.sql):
                // it refuses to approve onto a 'maintenance'/'blocked' vehicle. The reservation can
                // still legitimately sit here waiting — the vehicle may come back — but showing an
                // Approve button that's guaranteed to fail is worse than disabling it with a reason.
                const vehicleUnavailable =
                  r.vehicle?.status === "maintenance" || r.vehicle?.status === "blocked";
                return (
                  <li
                    key={r.id}
                    className="flex flex-col gap-3 rounded-sm border border-line-800 bg-panel-900/60 px-4 py-2.5 lg:flex-row lg:items-start lg:justify-between"
                  >
                    {/* Plate/requester/route/date alone is not enough to decide on: the
                        passenger count, the return time and the stated reason are what
                        make an approval a judgement rather than a rubber stamp — and the
                        route links into the reservation for messages/photos. */}
                    <div className="min-w-0 text-sm">
                      <div>
                        <span className="font-mono text-paper-50">{r.vehicle?.plate}</span>
                        <span className="text-fog-400">
                          {" "}
                          · {requesterName} ·{" "}
                          <Link
                            href={`/reservations/${r.id}`}
                            title={t.pendingReservations.openReservation}
                            className="text-fog-400 underline-offset-2 hover:text-gwm-accent hover:underline break-user-text"
                          >
                            {r.trip_request?.origin} → {r.trip_request?.destination}
                          </Link>{" "}
                          ·{" "}
                          <span className="font-mono tabular-nums">
                            {formatDateTimeShort(r.start_at, locale)}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fog-600">
                        <span>
                          {t.pendingReservations.passengers.replace(
                            "{count}",
                            String(r.trip_request?.passenger_count ?? 1),
                          )}
                        </span>
                        <span className="font-mono tabular-nums">
                          {t.pendingReservations.returnBy} {formatDateTimeShort(r.end_at, locale)}
                        </span>
                      </div>
                      <p
                        className="mt-1 text-xs text-fog-400"
                        title={justification || undefined}
                      >
                        <span className="text-fog-600">{t.pendingReservations.justification}: </span>
                        {justification
                          ? truncate(justification)
                          : t.pendingReservations.noJustification}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {vehicleUnavailable ? (
                        <span
                          className="rounded-sm border border-signal-red/40 bg-signal-red/10 px-3 py-1 text-xs uppercase tracking-widest text-signal-red"
                          title={t.pendingReservations.vehicleUnavailableHint}
                        >
                          {t.pendingReservations.vehicleUnavailable}
                        </span>
                      ) : (
                        <form action={approveReservation.bind(null, r.id)}>
                          <ConfirmSubmitButton
                            confirmMessage={t.pendingReservations.confirmApprove.replace(
                              "{name}",
                              requesterName,
                            )}
                            className="rounded-sm border border-signal-teal px-3 py-1 text-xs font-semibold uppercase tracking-widest text-signal-teal hover:bg-signal-teal/10"
                          >
                            {dict.common.approve}
                          </ConfirmSubmitButton>
                        </form>
                      )}
                      {/* Rejecting used to be one unguarded click that always stored the
                          same generic reason. Inline input + confirm: the requester gets
                          the manager's actual words, and a misclick is recoverable. */}
                      <form
                        action={cancelReservation.bind(
                          null,
                          r.id,
                          dict.dashboard.cancelReasons.rejectedByManager,
                        )}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          name="reason"
                          maxLength={200}
                          aria-label={t.pendingReservations.reasonLabel}
                          placeholder={t.pendingReservations.reasonPlaceholder}
                          className="w-52 rounded-sm border border-line-800 bg-panel-900 px-2 py-1 text-xs text-paper-50 placeholder:text-fog-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-red"
                        />
                        <ConfirmSubmitButton
                          confirmMessage={t.pendingReservations.confirmReject.replace(
                            "{name}",
                            requesterName,
                          )}
                          className="rounded-sm border border-signal-red px-3 py-1 text-xs font-semibold uppercase tracking-widest text-signal-red hover:bg-signal-red/10"
                        >
                          {dict.common.reject}
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {canManageTasks ? (
        <section className="fm-panel cc-tasks" id="open-tasks">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="fm-h2">
              {t.tasks.heading}
            </h2>
            {/* A single global queue gave a maintenance operator no way to see what is
                theirs. Plain links, so the filter survives a reload and stays shareable —
                no client state needed on a Server Component page. */}
            <div className="flex items-center gap-1 rounded-sm border border-line-800 p-0.5">
              <Link
                href="/dashboard?myTasks=1"
                aria-current={onlyMyTasks ? "true" : undefined}
                className={`rounded-sm px-2.5 py-1 text-xs uppercase tracking-widest ${
                  onlyMyTasks
                    ? "bg-gwm-accent/10 text-gwm-accent"
                    : "text-fog-400 hover:text-paper-50"
                }`}
              >
                {t.tasks.filterMine}
              </Link>
              <Link
                href="/dashboard"
                aria-current={onlyMyTasks ? undefined : "true"}
                className={`rounded-sm px-2.5 py-1 text-xs uppercase tracking-widest ${
                  onlyMyTasks
                    ? "text-fog-400 hover:text-paper-50"
                    : "bg-gwm-accent/10 text-gwm-accent"
                }`}
              >
                {t.tasks.filterAll}
              </Link>
            </div>
          </div>
          {!openTasks || openTasks.length === 0 ? (
            <p className="text-sm text-fog-400">{onlyMyTasks ? t.tasks.emptyMine : t.tasks.empty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {openTasks.map((task) => {
                const priority = (
                  task.priority === "high" || task.priority === "low" ? task.priority : "normal"
                ) as "low" | "normal" | "high";
                const priorityClass =
                  priority === "high"
                    ? "border-signal-red/40 bg-signal-red/10 text-signal-red"
                    : priority === "low"
                      ? "border-line-800 text-fog-600"
                      : "border-line-800 text-fog-400";
                return (
                  <li
                    key={task.id}
                    className="flex flex-col gap-2 rounded-sm border border-line-800 bg-panel-900/60 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 text-sm">
                      <span className="mr-1.5 font-mono text-gwm-accent" aria-hidden="true">
                        ›
                      </span>
                      <span className="rounded-sm border border-gwm-accent/40 bg-gwm-accent/10 px-1.5 py-0.5 text-xs text-gwm-accent">
                        {workflowTaskLabels[task.type] ?? task.type}
                      </span>
                      <span
                        title={t.tasks.priorityLabel}
                        className={`ml-1.5 rounded-sm border px-1.5 py-0.5 text-xs ${priorityClass}`}
                      >
                        {t.tasks.priorities[priority]}
                      </span>
                      <span className="ml-2 font-mono text-paper-50">{task.vehicle?.plate}</span>
                      {task.notes ? (
                        <span className="ml-2 text-fog-400" title={task.notes}>
                          {truncate(task.notes)}
                        </span>
                      ) : null}
                      <span className="ml-2 text-xs text-fog-600">
                        {task.assigned_to
                          ? t.tasks.assignedTo.replace(
                              "{name}",
                              task.assignee?.full_name ?? t.tasks.assigneeNameUnavailable,
                            )
                          : t.tasks.unassigned}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!task.assigned_to ? (
                        <form action={claimWorkflowTask.bind(null, task.id)}>
                          <input type="hidden" name="myTasks" value={onlyMyTasks ? "1" : "0"} />
                          <ConfirmSubmitButton
                            confirmMessage={t.tasks.confirmClaim}
                            pendingLabel={t.tasks.claiming}
                            className="rounded-sm border border-gwm-accent px-3 py-1 text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:bg-gwm-accent/10"
                          >
                            {t.tasks.claim}
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
                      <form action={completeWorkflowTask.bind(null, task.id)}>
                        <input type="hidden" name="myTasks" value={onlyMyTasks ? "1" : "0"} />
                        <ConfirmSubmitButton
                          confirmMessage={t.tasks.confirmComplete}
                          className="rounded-sm border border-line-800 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-teal hover:text-signal-teal"
                        >
                          {t.tasks.complete}
                        </ConfirmSubmitButton>
                      </form>
                      <form action={cancelWorkflowTask.bind(null, task.id)}>
                        <input type="hidden" name="myTasks" value={onlyMyTasks ? "1" : "0"} />
                        <ConfirmSubmitButton
                          confirmMessage={t.tasks.confirmCancel}
                          className="rounded-sm border border-line-800 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red"
                        >
                          {dict.common.cancel}
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      </div>

      {isFleetManager ? (
        <section className="fm-panel cc-active" id="active-reservations">
          <h2 className="fm-h2">
            {t.activeReservations.heading}
          </h2>
          {conflictedReservationIds.size > 0 ? (
            <p role="alert" className="mb-3 text-sm text-signal-red">
              {t.activeReservations.overlapWarning}
            </p>
          ) : null}
          {!activeReservations || activeReservations.length === 0 ? (
            <p className="text-sm text-fog-400">{t.activeReservations.empty}</p>
          ) : (
            <>
            <div className="cc-gantt">
            <ReservationGantt
              bars={activeReservations.map((r) => ({
                id: r.id,
                start_at: r.start_at,
                end_at: r.end_at,
                status: r.status,
                rowPlate: r.vehicle?.plate ?? "—",
                rowVehicleName: r.vehicle?.name ?? r.vehicle?.plate ?? "—",
                barLabel: r.trip_request?.requester?.full_name ?? t.activeReservations.unknownRequester,
                tooltipExtra: r.trip_request?.destination,
              }))}
              locale={locale}
              rowHeading={dict.common.vehicle}
              initialZoom={(profile?.gantt_zoom_preference as GanttZoomLevel) ?? "month"}
            />
            </div>
            <div className="cc-table-wrap overflow-x-auto rounded-md border border-line-800">
              <table className="w-full min-w-[1200px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line-800 text-left text-xs uppercase tracking-widest text-fog-600">
                    <th className="px-4 py-3 font-medium">{dict.common.vehicle}</th>
                    <th className="px-4 py-3 font-medium">{t.activeReservations.routeColumn}</th>
                    <th className="px-4 py-3 font-medium">{t.activeReservations.requesterColumn}</th>
                    <th className="px-4 py-3 font-medium">{t.activeReservations.departureColumn}</th>
                    <th className="px-4 py-3 font-medium">{t.activeReservations.returnColumn}</th>
                    <th className="px-4 py-3 font-medium">{dict.common.status}</th>
                    <th className="px-4 py-3 font-medium">{t.activeReservations.swapColumn}</th>
                    <th className="px-4 py-3 font-medium">{t.activeReservations.transferColumn}</th>
                    <th className="px-4 py-3 font-medium">{dict.common.cancel}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeReservations.map((r) => {
                    const vehicleOptions = vehicles.filter(
                      (v) => v.status === "available" && v.id !== r.vehicle?.id,
                    );
                    const transferOptions = (orgProfiles ?? []).filter(
                      (p) => p.id !== r.trip_request?.requester_id,
                    );
                    return (
                      <tr key={r.id} className="border-b border-line-800 last:border-0 hover:bg-panel-900/60">
                        <td className="px-4 py-3 font-mono tabular-nums text-paper-50">
                          {r.vehicle?.plate ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-fog-400 break-user-text">
                          {r.trip_request?.origin} → {r.trip_request?.destination}
                        </td>
                        <td className="px-4 py-3 text-fog-400">
                          {r.trip_request?.requester?.full_name ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums text-fog-400">
                          {formatDateTimeShort(r.start_at, locale)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums text-fog-400">
                          {formatDateTimeShort(r.end_at, locale)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={r.status === "confirmed" ? "text-signal-blue" : "text-gwm-accent"}>
                            {r.status === "confirmed"
                              ? t.activeReservations.statusConfirmed
                              : t.activeReservations.statusPending}
                          </span>
                          {r.impacted_at ? (
                            <span className="ml-2 text-xs text-signal-yellow">
                              {t.activeReservations.impacted}
                            </span>
                          ) : null}
                          {conflictedReservationIds.has(r.id) ? (
                            <span
                              className="ml-2 text-xs text-signal-red"
                              title={t.activeReservations.overlapWarning}
                            >
                              {t.activeReservations.overlapBadge}
                            </span>
                          ) : null}
                          <Link
                            href={`/reservations/${r.id}`}
                            className="ml-2 text-xs text-fog-400 hover:text-gwm-accent hover:underline"
                          >
                            {t.activeReservations.messages}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          {vehicleOptions.length === 0 ? (
                            <span className="text-xs text-fog-600">
                              {t.activeReservations.noVehicleAvailable}
                            </span>
                          ) : (
                            <RevealAction trigger={t.activeReservations.swapAction}>
                              <form action={swapVehicle.bind(null, r.id)} className="flex items-center gap-2">
                                <select
                                  name="vehicleId"
                                  required
                                  defaultValue=""
                                  className="rounded-sm border border-line-800 bg-panel-900 px-2 py-1 text-xs text-paper-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-blue"
                                >
                                  <option value="" disabled>
                                    {t.activeReservations.selectPlaceholder}
                                  </option>
                                  {vehicleOptions.map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.plate} — {v.category?.name ?? "—"}
                                      {v.color ? ` · ${v.color}` : ""}
                                    </option>
                                  ))}
                                </select>
                                <ConfirmSubmitButton
                                  confirmMessage={t.activeReservations.confirmSwap}
                                  className="rounded-sm border border-signal-blue px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-signal-blue hover:bg-signal-blue/10"
                                >
                                  {t.activeReservations.swapAction}
                                </ConfirmSubmitButton>
                              </form>
                            </RevealAction>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {transferOptions.length === 0 ? (
                            <span className="text-xs text-fog-600">—</span>
                          ) : (
                            <RevealAction trigger={t.activeReservations.transferAction}>
                              <form action={transferReservation.bind(null, r.id)} className="flex items-center gap-2">
                                <select
                                  name="requesterId"
                                  required
                                  defaultValue=""
                                  className="rounded-sm border border-line-800 bg-panel-900 px-2 py-1 text-xs text-paper-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-violet"
                                >
                                  <option value="" disabled>
                                    {t.activeReservations.selectPlaceholder}
                                  </option>
                                  {transferOptions.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.full_name}
                                    </option>
                                  ))}
                                </select>
                                <ConfirmSubmitButton
                                  confirmMessage={t.activeReservations.confirmTransfer}
                                  className="rounded-sm border border-signal-violet px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-signal-violet hover:bg-signal-violet/10"
                                >
                                  {t.activeReservations.transferAction}
                                </ConfirmSubmitButton>
                              </form>
                            </RevealAction>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <form action={cancelReservation.bind(null, r.id, dict.dashboard.cancelReasons.cancelledByManager)}>
                            <ConfirmSubmitButton
                              confirmMessage={t.activeReservations.confirmCancel.replace(
                                "{name}",
                                r.trip_request?.requester?.full_name ??
                                  t.activeReservations.unknownRequester,
                              )}
                              className="rounded-sm border border-signal-red px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-signal-red hover:bg-signal-red/10"
                            >
                              {dict.common.cancel}
                            </ConfirmSubmitButton>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </section>
      ) : null}

      <section className="fm-panel cc-fleet" id="fleet-vehicles">
        <h2 className="fm-h2">
          {t.vehicles.heading}
        </h2>

        {vehiclesError ? (
          <p className="text-sm text-signal-red">{t.vehicles.loadError}</p>
        ) : vehicles.length === 0 ? (
          <p className="text-sm text-fog-400">
            {t.vehicles.emptyLead}{" "}
            {isFleetManager ? (
              <Link href="/fleet" className="text-gwm-accent hover:underline">
                {t.vehicles.emptyManagerCta}
              </Link>
            ) : (
              t.vehicles.emptyEmployeeHint
            )}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {vehiclesWithAttention.map(({ row, attention }) => {
              const meta = statusMeta[row.status];
              return (
                <li
                  key={row.id}
                  id={`vehicle-${row.id}`}
                  className="flex scroll-mt-4 flex-col gap-3 rounded-md border border-line-800 bg-panel-900/60 p-4 target:border-gwm-accent"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-lg text-paper-50">{row.plate}</p>
                      <p className="text-xs text-fog-400">{row.category?.name ?? "—"}</p>
                    </div>
                    <StatusBadge meta={meta} />
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line-800 pt-3 text-xs">
                    {(() => {
                      // A PHEV has both a fuel tank and a plug-in battery — mirrors
                      // VehicleForm.tsx's showFuel/showBattery so the panel doesn't
                      // silently drop one of the two gauges for hybrids.
                      const energyType = row.category?.energy_type;
                      const showFuel = energyType === "ICE" || energyType === "HEV" || energyType === "PHEV";
                      const showBattery = energyType === "BEV" || energyType === "PHEV";
                      return (
                        <>
                          {showFuel ? (
                            <div>
                              <p className="uppercase tracking-widest text-fog-600">{t.vehicles.fuel}</p>
                              <EnergyGauge percent={row.fuel_level_percent} kind="fuel" dict={dict} />
                            </div>
                          ) : null}
                          {showBattery ? (
                            <div>
                              <p className="uppercase tracking-widest text-fog-600">{t.vehicles.battery}</p>
                              <EnergyGauge percent={row.battery_level_percent} kind="battery" dict={dict} />
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                    <div>
                      <p className="uppercase tracking-widest text-fog-600">{t.vehicles.odometer}</p>
                      <p className="mt-1 font-mono tabular-nums text-fog-400">
                        {row.odometer_km.toLocaleString(locale)} km
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="uppercase tracking-widest text-fog-600">
                        {t.vehicles.currentLocation}
                      </p>
                      <p className="mt-1 text-fog-400">{row.current_location?.name ?? "—"}</p>
                    </div>
                  </div>

                  {attention.length > 0 ? (
                    <div className="flex flex-wrap gap-1 border-t border-line-800 pt-3">
                      {attention.map((reason) => (
                        <span
                          key={reason}
                          className="relative overflow-hidden rounded-sm border border-gwm-accent/40 border-t-transparent bg-gwm-accent/10 px-1.5 py-0.5 text-xs text-gwm-accent"
                        >
                          <span className="hazard-stripe absolute inset-x-0 top-0 h-[3px]" aria-hidden="true" />
                          {attentionLabels[reason] ?? reason}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {isFleetManager && row.status !== "in_use" && row.status !== "returning" ? (
                    <div className="border-t border-line-800 pt-3">
                      {row.status === "blocked" ? (
                        <form action={unblockVehicle.bind(null, row.id)}>
                          <ConfirmSubmitButton
                            confirmMessage={t.vehicles.confirmUnblock.replace("{plate}", row.plate)}
                            className="w-full rounded-sm border border-signal-teal px-2.5 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-teal hover:bg-signal-teal/10"
                          >
                            {t.vehicles.unblock}
                          </ConfirmSubmitButton>
                        </form>
                      ) : (
                        // The reason is what the requesters' block notification shows, so an
                        // empty one is no longer allowed to fall through to a generic default
                        // — the button stays disabled until the manager actually types one.
                        <BlockVehicleForm
                          action={blockVehicle.bind(null, row.id, t.vehicles.blockReasonDefault)}
                          confirmMessage={t.vehicles.confirmBlock.replace("{plate}", row.plate)}
                          reasonLabel={t.vehicles.blockReasonLabel}
                          reasonPlaceholder={t.vehicles.blockReasonPlaceholder}
                          blockLabel={t.vehicles.block}
                        />
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </FmShell>
  );
}
