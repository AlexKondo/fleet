import {loadEquipmentContract} from "@/lib/equipment/contract";
import { GateVisualForm } from "@/app/gate/GateVisualForm";
import { loadChecklistState } from "@/lib/operations/checklistState";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { ReturnForm } from "./ReturnForm";
import { ChecklistFrame } from "../ChecklistFrame";
import { getDictionary, getLocale } from "../../../../lib/i18n/getLocale";

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dict = await getDictionary();
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  // §14 Current Vehicle Location: the return checklist is where the traveler reports
  // where they parked, so the location picker is scoped to this org's vehicle_locations
  // the same way the Fleet Manager dashboard's "Localização Atual" column is. It depends
  // on nothing above it, so it rides along here instead of costing its own round trip
  // after every authorization check has already passed.
  const [{ data: profile }, { data: reservation }, { data: locations }] = await Promise.all([
    supabase.from("profiles").select("full_name, role, organization_id, organization:organizations(name)").eq("id", user.id).single(),
    supabase
      .from("reservations")
      .select(
        `id, status,
       trip_request:trip_requests(origin, destination, requester_id),
       vehicle:vehicles(id, plate, name, color, status, odometer_km, estimated_range_km,
         home_location_id, category:vehicle_categories(name, energy_type))`,
      )
      .eq("id", id)
      .single(),
    supabase.from("vehicle_locations").select("id, name").eq("enabled",true).order("name"),
  ]);

  if (!reservation || !reservation.vehicle || !reservation.trip_request) notFound();

  const vehicle = reservation.vehicle;

  // Same authorization rule as reservations/[id]/page.tsx (and as record_return itself,
  // 0004_operational_actions.sql): the trip's own requester, or a privileged fleet role.
  const isPrivileged =
    profile?.role === "fleet_manager" ||
    profile?.role === "administrator" ||
    profile?.role === "security";
  // Security never requests trips, so /trips is permanently empty for them (the same
  // reason /gate exists) — bounce them back there instead of into a dead end.
  const fallbackPath = profile?.role === "security" ? "/gate" : "/trips";
  if (!isPrivileged && reservation.trip_request.requester_id !== user.id) {
    redirect(`${fallbackPath}?tripActionError=checklist_not_authorized`);
  }

  const state=await loadChecklistState(supabase,id);
  if(!state) redirect(`${fallbackPath}?tripActionError=checklist_unavailable`);
  if(state.own_return_id) redirect(`/reservations/${id}/evidence/${state.own_return_id}`);
  if(!state.can_return) redirect(`${fallbackPath}?tripActionError=return_wrong_status`);
  const energyType = vehicle.category?.energy_type ?? "ICE";
  const showElectricRange = energyType === "BEV" || energyType === "PHEV";

  const equipmentContract=state.inspection_role==="security"?null:await loadEquipmentContract(supabase,id);
  const equipmentItems=equipmentContract?.required_names.map((name,index)=>({id:`${equipmentContract.id}-${index}`,name}))??[];

  return (
    <ChecklistFrame
      dict={dict}
      title={state.inspection_role==="security" ? dict.ops.gate.visualTitle : dict.reservations.return.title}
      intro={state.inspection_role==="security" ? dict.ops.gate.visualDescription : dict.reservations.checklist.returnIntro}
      shell={{
        orgName: profile?.organization?.name ?? "—",
        userName: profile?.full_name ?? user.email ?? "—",
        role: profile?.role ?? "employee",
      }}
      vehicle={{
        plate: vehicle.plate,
        name: vehicle.name,
        color: vehicle.color,
        categoryName: vehicle.category?.name ?? null,
        energyType,
        estimatedRangeKm: vehicle.estimated_range_km,
      }}
      showElectricRange={state.inspection_role==="security" ? false : showElectricRange}
      route={{ origin: reservation.trip_request?.origin, destination: reservation.trip_request?.destination }}
    >
        {state.inspection_role==="security" ? <GateVisualForm reservationId={id} phase="return" dict={dict}/> : (
        equipmentContract?<><p>Equipamentos: {equipmentContract.source==="legacy_return_observation"?"Observações do processo legado; requisitos específicos ainda não verificados":`Conjunto ${equipmentContract.source==="vehicle"?"do veículo":"do modelo"} · revisão ${equipmentContract.configuration_version}`}</p>{equipmentContract.optional_names.length>0&&<p>Itens disponíveis sem exigência de ausência no checklist: {equipmentContract.optional_names.join(", ")}</p>}
        <ReturnForm
          reservationId={reservation.id}
          energyType={energyType}
          currentOdometer={vehicle.odometer_km}
          locations={locations ?? []}
          homeLocationId={vehicle.home_location_id}
          equipmentItems={equipmentItems ?? []}
          dict={dict}
          locale={locale}
        /></>:<p role="alert">Não foi possível preparar a configuração de equipamentos. Solicite ao gestor a configuração deste veículo antes de uma nova retirada. O registro físico de chegada continua disponível na unidade.</p>
        )}
    </ChecklistFrame>
  );
}
