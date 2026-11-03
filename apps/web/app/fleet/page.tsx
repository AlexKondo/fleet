import Link from "next/link";
import {loadUnitDimension} from "@/lib/operations/unitDimension";
import {AssistantTrigger} from "../carpool/AssistantTrigger";
import {pageAll} from "@/lib/carpool/kpi/loadKpis";
import {loadManagementScope} from "@/lib/operations/managerScope";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { areaText } from "@/lib/i18n/areaText";
import { fleetTexts } from "@/lib/i18n/areas/fleet";
import { VEHICLE_STATUSES, getStatusMeta } from "../dashboard/statusMeta";
import { FmShell } from "../carpool/FmShell";
import { FmCarIcon } from "../fmIcons";
import { AddCategorySection } from "./AddCategorySection";
import { AddLocationSection } from "./AddLocationSection";
import { AddVehicleSection } from "./AddVehicleSection";
import { FleetTabs } from "./FleetTabs";
import { LocationRow } from "./LocationRow";
import { CategoryRow } from "./CategoryRow";
import { VehicleRow } from "./VehicleRow";
import { VehicleFilterGrid } from "./VehicleFilterGrid";
import { timelineWindow, type TimelineBooking } from "./timelineLayout";
import { EmptyState } from "./EmptyState";

/**
 * Fleet setup: add vehicles, categories, and locations. Until this page existed, a
 * brand-new organization created via /signup had no way to populate its own fleet
 * except a direct SQL insert (which is how the seeded demo org's 10 vehicles got
 * there) — the entire rest of the app (trip requests, checklists, dashboard) is
 * unusable without at least one vehicle.
 */
export default async function FleetPage() {
  const supabase = await createSupabaseServerClient();
  const [managementScope,unitDimension]=await Promise.all([loadManagementScope(supabase),loadUnitDimension(supabase)]);
  const dict = await getDictionary();
  const locale = await getLocale();
  const T = areaText(fleetTexts, locale);
  const statusMeta = getStatusMeta(dict);
  // Options for the client-side status filter, localized here so the client component
  // never needs the status → label map itself.
  const statusOptions = VEHICLE_STATUSES.map((s) => ({ value: s, label: statusMeta[s].label }));

  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  // The profile lookup is folded into the same round trip as the three fleet queries:
  // none of them are scoped by anything on `profile` (RLS already scopes them to the
  // caller's org), so gating on the role *before* issuing them only bought a wasted
  // sequential round trip on every load. An unauthorized role still never sees the data —
  // it's discarded by the redirect below.
  const [
    { data: profile },
    { data: locations, error: locationsError },
    { data: categories, error: categoriesError },
    { data: vehicles, error: vehiclesError },
    { data: mobilityPointRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, role, organization_id, organization:organizations(name)")
      .eq("id", user.id)
      .single(),
    supabase.from("vehicle_locations").select("id, name,lifecycle_version,mobility_point_id").eq("enabled",true).order("name"),
    supabase.from("vehicle_categories").select("id, name, passenger_capacity, supports_cargo, energy_type,lifecycle_version").eq("enabled",true).order("name"),
    pageAll("fleet vehicles",(a,b)=>supabase
      .from("fm_managed_vehicles")
      .select(
        "id, plate, name, vin, next_service_date, color, photo_storage_path, lifecycle_version, category_id, status, odometer_km, next_service_odometer_km, estimated_range_km, fuel_level_percent, battery_level_percent, home_location_id, category:vehicle_categories(name, energy_type), current_location:vehicle_locations!vehicles_current_location_id_fkey(name)",
      ).is("archived_at",null)
      .order("plate").order("id").range(a,b)).then(data=>({data,error:null})).catch(()=>({data:null,error:{message:"fleet_unavailable"}})),
    supabase.from("corporate_mobility_points").select("id, name").eq("is_active", true).order("name"),
  ]);
  const mobilityPoints = mobilityPointRows ?? [];

  // Checklist items (0041_safety_equipment_items.sql) shown right here — a fleet manager
  // registering a vehicle is exactly the moment they'd notice the standard kit is
  // missing something, not just tucked away in a separate Settings page.
  const { data: equipmentItems } = profile?.organization_id
    ? await supabase
        .from("safety_equipment_items")
        .select("id, name").eq("enabled",true)
        .eq("organization_id", profile.organization_id)
        .order("created_at")
    : { data: [] as { id: string; name: string }[] };

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";
  if (!profile || !isFleetManager) redirect("/dashboard");

  const loadError = locationsError || categoriesError || vehiclesError;

  // VehicleForm/EditVehicleForm read `energyType` (camelCase) to decide which fuel/
  // battery field to show for the currently-selected category.
  const categoriesForVehicleForms = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    energyType: c.energy_type,
  }));

  // vehicle-photos is a private bucket (0002_operational_cycle.sql) — cards need a
  // short-lived signed URL per photo rather than a public one.
  const photoPaths = (vehicles ?? [])
    .map((v) => v.photo_storage_path)
    .filter((p): p is string => Boolean(p));
  const { data: signedPhotoUrls } =
    photoPaths.length > 0
      ? await supabase.storage.from("vehicle-photos").createSignedUrls(photoPaths, 60 * 60)
      : { data: [] as { path: string | null; signedUrl: string }[] };
  const photoUrlByPath = new Map(
    (signedPhotoUrls ?? [])
      .filter((s) => s.path && s.signedUrl)
      .map((s) => [s.path as string, s.signedUrl]),
  );

  // Schedule of each vehicle (the chart next to the list): its reservations of the chart window and, for the trips that have an active carpool, the seats.
  const nowMs = Date.now();
  const windowStartIso = new Date(timelineWindow(nowMs).start).toISOString();
  const { data: bookingRows } = await supabase
    .from("fm_managed_reservations")
    .select("id, vehicle_id, status, start_at, end_at, trip_request_id, trip_request:trip_requests(destination, requester:profiles(full_name))")
    .in("status", ["pending_approval", "confirmed", "completed"])
    .gte("end_at", windowStartIso)
    .order("start_at", { ascending: true });
  const tripIds = Array.from(new Set((bookingRows ?? []).map((r) => r.trip_request_id).filter((x): x is string => Boolean(x))));
  const [{ data: offerRows }, { data: seatRows }] = tripIds.length
    ? await Promise.all([
        supabase.from("carpool_offers").select("trip_request_id, seats_offered").eq("status", "active").in("trip_request_id", tripIds),
        supabase.from("trip_participants").select("trip_request_id, passenger_count").eq("status", "accepted").in("trip_request_id", tripIds),
      ])
    : [{ data: [] as { trip_request_id: string; seats_offered: number }[] }, { data: [] as { trip_request_id: string; passenger_count: number }[] }];
  const offerByTrip = new Map((offerRows ?? []).map((o) => [o.trip_request_id, o.seats_offered]));
  const takenByTrip = new Map<string, number>();
  for (const p of seatRows ?? []) takenByTrip.set(p.trip_request_id, (takenByTrip.get(p.trip_request_id) ?? 0) + p.passenger_count);
  const bookingsByVehicle = new Map<string, TimelineBooking[]>();
  for (const r of bookingRows ?? []) {
    if (!r.vehicle_id || !r.id) continue;
    const seats = r.trip_request_id ? offerByTrip.get(r.trip_request_id) : undefined;
    const tr = r.trip_request as { destination?: string; requester?: { full_name?: string } | null } | null;
    const list = bookingsByVehicle.get(r.vehicle_id) ?? [];
    list.push({
      id: r.id,
      start: r.start_at as string,
      end: r.end_at as string,
      status: r.status as string,
      label: [tr?.requester?.full_name, tr?.destination].filter(Boolean).join(" · ") || "—",
      // the carpool bar is for a carpool that is happening: an offer nobody joined yet is not shown
      carpool: seats && (takenByTrip.get(r.trip_request_id as string) ?? 0) > 0 ? { seats, taken: takenByTrip.get(r.trip_request_id as string) ?? 0 } : undefined,
    });
    bookingsByVehicle.set(r.vehicle_id, list);
  }

  // Veículos (SCR-FM-002) tiles: counts of rows already loaded above.
  const o = dict.ops.fleet;
  const statusCounts = new Map<string, number>();
  const energyCounts = new Map<string, number>();
  for (const v of vehicles ?? []) {
    statusCounts.set(v.status, (statusCounts.get(v.status) ?? 0) + 1);
    const e = v.category?.energy_type;
    if (e) energyCounts.set(e, (energyCounts.get(e) ?? 0) + 1);
  }

  return (
    <FmShell
      active="fleet"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={T.pageTitle}
      subtitle={o.subtitle}
      nonDrivingWorkspace
      legacy
      headerActions={<AssistantTrigger voice className="fm-btn fm-btn-primary">{T.talkToFleetMind}</AssistantTrigger>}
      wide
    >
      <section className="fm-kpis fleet-kpis" aria-label={o.kpisLabel} data-testid="fleet-kpis">
        <div className="fm-kpi fm-kpi-wide" data-testid="fleet-kpi-total">
          <span className="fm-kpi-icon"><FmCarIcon /></span>
          <div className="fm-kpi-body">
            <p className="fm-kpi-value">{vehiclesError ? "—" : vehicles?.length ?? 0}</p>
            <p className="fm-kpi-label">{o.kpiTotal}</p>
          </div>
          {(vehicles?.length ?? 0) > 0 ? (
            <>
              <div className="fm-seg" role="img" aria-label={o.kpiStatusBar}>
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
        {(["BEV", "PHEV", "HEV", "ICE"] as const)
          .filter((e) => energyCounts.has(e))
          .map((e) => (
            <div key={e} className="fm-kpi" data-testid={`fleet-kpi-${e}`}>
              <span className="fm-kpi-icon" data-tone={e === "BEV" ? "ok" : e === "PHEV" ? "violet" : e === "HEV" ? "info" : "warn"}><FmCarIcon /></span>
              <div className="fm-kpi-body">
                <p className="fm-kpi-value">{energyCounts.get(e)}</p>
                <p className="fm-kpi-label">{dict.fleet.categories.energy[e]}</p>
              </div>
            </div>
          ))}
      </section>

      {loadError ? (
        <div
          role="alert"
          className="fm-banner fm-banner-danger"
          style={{ marginTop: 0, marginBottom: 16 }}
        >
          {dict.fleet.loadError}
        </div>
      ) : null}

      <p><Link href="/fleet/archive">{T.archiveLink}</Link></p>
      <section>
        <FleetTabs
          tabs={[
            {
              key: "vehicles",
              label: dict.fleet.tabs.vehicles,
              count: vehicles?.length ?? 0,
              content: (
                <div className="flex flex-col gap-4">
                  {vehicles && vehicles.length > 0 ? (
                    <VehicleFilterGrid
                      dict={dict}
                      T={T}
                      locale={locale}
                      dimensionsAvailable={unitDimension!==null}
                      now={nowMs}
                      statusOptions={statusOptions}
                      vehicles={vehicles.map((v) => ({
                        id: v.id,
                        plate: v.plate,
                        name: v.name,
                        status: v.status,
                        categoryName: v.category?.name ?? "—",
                        energyType:v.category?.energy_type,
                        unitId:unitDimension?.bindings.find(b=>b.vehicle_id===v.id)?.unit_id,
                        unitName:unitDimension?.units.find(u=>u.id===unitDimension.bindings.find(b=>b.vehicle_id===v.id)?.unit_id)?.name,
                        photoUrl:v.photo_storage_path?(photoUrlByPath.get(v.photo_storage_path)??null):null,
                        locationName:v.current_location?.name??"—",
                        bookings:bookingsByVehicle.get(v.id)??[],
                        odometerKm:v.odometer_km,nextServiceKm:v.next_service_odometer_km,vin:v.vin,nextServiceDate:v.next_service_date,
                        fuelPercent:v.fuel_level_percent,batteryPercent:v.battery_level_percent,rangeKm:v.estimated_range_km,
                        node: (
                          <VehicleRow
                            key={v.id}
                            locale={locale}
                            T={T}
                            vehicle={{
                              id: v.id,
                              lifecycle_version:v.lifecycle_version,
                              plate: v.plate,
                              name: v.name,
                              color: v.color,
                              photoUrl: v.photo_storage_path
                                ? (photoUrlByPath.get(v.photo_storage_path) ?? null)
                                : null,
                              category_id: v.category_id,
                              odometer_km: v.odometer_km,
                              next_service_odometer_km: v.next_service_odometer_km,
                              estimated_range_km: v.estimated_range_km,
                              fuel_level_percent: v.fuel_level_percent,
                              battery_level_percent: v.battery_level_percent,
                              home_location_id: v.home_location_id,
                            }}
                            statusMeta={statusMeta[v.status]}
                            categoryName={v.category?.name ?? "—"}
                            locationName={v.current_location?.name ?? "—"}
                            categories={categoriesForVehicleForms}
                            locations={locations ?? []}
                            dict={dict}
                          />
                        ),
                      }))}
                    />
                  ) : vehiclesError ? <p role="status">{T.vehiclesUnavailable}</p> : (
                    <EmptyState
                      lead={dict.fleet.emptyState.vehiclesLead}
                      hint={dict.fleet.emptyState.vehiclesHint}
                    />
                  )}
                  <AddVehicleSection
                    managementScope={managementScope}
                    categories={categoriesForVehicleForms}
                    locations={locations ?? []}
                    equipmentItems={equipmentItems ?? []}
                    dict={dict}
                    T={T}
                  />
                </div>
              ),
            },
            {
              key: "categories",
              label: dict.fleet.tabs.categories,
              count: categories?.length ?? 0,
              content: (
                <div className="flex flex-col gap-4">
                  {categories && categories.length > 0 ? (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {categories.map((c) => (
                        <CategoryRow key={c.id} category={c} dict={dict} T={T} />
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      lead={dict.fleet.emptyState.categoriesLead}
                      hint={dict.fleet.emptyState.categoriesHint}
                    />
                  )}
                  <AddCategorySection dict={dict} />
                </div>
              ),
            },
            {
              key: "locations",
              label: dict.fleet.tabs.locations,
              count: locations?.length ?? 0,
              content: (
                <div className="flex flex-col gap-4">
                  {locations && locations.length > 0 ? (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {locations.map((l) => (
                        <LocationRow key={l.id} location={l} mobilityPoints={mobilityPoints} dict={dict} T={T} />
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      lead={dict.fleet.emptyState.locationsLead}
                      hint={dict.fleet.emptyState.locationsHint}
                    />
                  )}
                  <AddLocationSection dict={dict} mobilityPoints={mobilityPoints} />
                </div>
              ),
            },
          ]}
        />
      </section>
    </FmShell>
  );
}
