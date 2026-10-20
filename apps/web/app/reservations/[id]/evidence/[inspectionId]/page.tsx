import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {getCurrentUser} from "@/lib/auth/currentUser";
import {FmShell} from "@/app/carpool/FmShell";
import {EvidenceForm} from "./EvidenceForm";
import "../../checklist.css";
export default async function EvidencePage({params}:{params:Promise<{id:string;inspectionId:string}>}){
 const {id,inspectionId}=await params;const db=await createSupabaseServerClient();const user=await getCurrentUser(db);
 if(!user)redirect("/login");
 const [{data:inspection},{data:profile}]=await Promise.all([
  db.from("inspections").select("id,type,performed_by,vehicle:vehicles(plate)").eq("id",inspectionId).eq("reservation_id",id).eq("performed_by",user.id).single(),
  db.from("profiles").select("full_name,role,organization:organizations(name)").eq("id",user.id).single(),
 ]);
 if(!inspection||!profile)notFound();
 return <FmShell orgName={profile.organization?.name??"—"} userName={profile.full_name} role={profile.role} isFleetManager={["fleet_manager","administrator"].includes(profile.role)} isAdministrator={profile.role==="administrator"} active="trips" legacy wide>
  <h1 className="fm-h1">Evidências do checklist · {inspection.vehicle?.plate}</h1>
  <p className="fm-muted">Adicione fotos à sua inspeção. As observações registradas e as fotos anteriores são preservadas.</p>
  <EvidenceForm inspectionId={inspection.id} reservationId={id}/>
  <Link className="fm-btn fm-btn-ghost" href={`/reservations/${id}`}>Voltar à viagem</Link>
 </FmShell>;
}
