import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {getCurrentUser} from "@/lib/auth/currentUser";
import {FmShell} from "@/app/carpool/FmShell";
import {getDictionary} from "@/lib/i18n/getLocale";
import {EvidenceForm} from "./EvidenceForm";
import "../../checklist.css";
export default async function EvidencePage({params}:{params:Promise<{id:string;inspectionId:string}>}){
 const {id,inspectionId}=await params;const db=await createSupabaseServerClient();const user=await getCurrentUser(db);
 if(!user)redirect("/login");
 const [{data:inspection},{data:profile}]=await Promise.all([
  db.from("inspections").select("id,type,performed_by,has_new_damage,vehicle:vehicles(plate)").eq("id",inspectionId).eq("reservation_id",id).eq("performed_by",user.id).single(),
  db.from("profiles").select("full_name,role,organization:organizations(name)").eq("id",user.id).single(),
 ]);
 if(!inspection||!profile)notFound();
 // T2-D01: a check that records damage but has no damage photo yet is incomplete evidence — say so here
 // (the pickup/return page redirects to this page once the check exists) and preselect "damage".
 const dict=await getDictionary();
 let damagePhotoMissing=false;
 if(inspection.has_new_damage){const {count,error}=await db.from("inspection_photos").select("id",{count:"exact",head:true}).eq("inspection_id",inspection.id).eq("angle","damage");damagePhotoMissing=!error&&(count??0)===0;}
 return <FmShell orgName={profile.organization?.name??"—"} userName={profile.full_name} role={profile.role} isFleetManager={["fleet_manager","administrator"].includes(profile.role)} isAdministrator={profile.role==="administrator"} active="trips" legacy wide>
  <h1 className="fm-h1">Evidências do checklist · {inspection.vehicle?.plate}</h1>
  <p className="fm-muted">Adicione fotos à sua inspeção. As observações registradas e as fotos anteriores são preservadas.</p>
  {damagePhotoMissing?<p role="alert" className="fm-banner fm-banner-danger ck-msg">{dict.reservations.checklist.evidenceDamagePhotoMissing}</p>:null}
  <EvidenceForm inspectionId={inspection.id} reservationId={id} defaultAngle={damagePhotoMissing?"damage":undefined} typeError={dict.reservations.checklist.photoTypeNotSupported}/>
  <Link className="fm-btn fm-btn-ghost" href={`/reservations/${id}`}>Voltar à viagem</Link>
 </FmShell>;
}
