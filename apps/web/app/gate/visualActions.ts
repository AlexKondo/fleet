"use server";
import {revalidatePath} from "next/cache";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {getCurrentUser} from "@/lib/auth/currentUser";
import {loadChecklistState} from "@/lib/operations/checklistState";
import {uploadInspectionPhotos} from "@/lib/domain/uploadInspectionPhotos";
export async function submitVisualCheck(form:FormData):Promise<{success:boolean;error?:string;inspectionId?:string}>{
 const db=await createSupabaseServerClient();const user=await getCurrentUser(db);
 if(!user)return {success:false,error:"Entre novamente para continuar."};
 const id=String(form.get("reservationId")??"");const phase=String(form.get("phase")??"");
 if(phase!=="pickup" && phase!=="return")return {success:false,error:"Etapa inválida."};
 const state=await loadChecklistState(db,id);
 if(state?.inspection_role!=="security")return {success:false,error:"Conferência visual não autorizada para seu perfil."};
 const {data:profile}=await db.from("profiles").select("organization_id").eq("id",user.id).single();
 if(!profile)return {success:false,error:"Não foi possível validar seu perfil."};
 const damage=form.get("hasDamage")==="on";const notes=damage?String(form.get("notes")??"").trim():null;
 const photo=form.get("photo_damage");
 if(damage && (!notes || (form.get("photo_upload_pending")!=="true" && ( !(photo instanceof File) || photo.size===0 || photo.size>5*1024*1024 || !photo.type.startsWith("image/")))))return {success:false,error:"Descreva a avaria e anexe uma foto de até 5 MB."};
 const common={p_reservation_id:id,p_role:"security" as const,p_odometer_km:null,p_fuel_level_percent:null,p_battery_level_percent:null,p_damage_notes:notes,p_missing_safety_equipment:null,p_is_dirty_exterior:null,p_is_dirty_interior:null};
 const response=phase==="pickup"?await db.rpc("record_pickup",{...common,p_has_damage:damage}):await db.rpc("record_return",{...common,p_has_new_damage:damage,p_current_location_id:null,p_vehicle_event:"",p_workflow_tasks:[]});
 if(response.error || !response.data)return {success:false,error:"Não foi possível registrar esta etapa. Confira o estado da viagem e os movimentos físicos."};
 if(damage&&photo instanceof File){const photos=new FormData();photos.append("photo_damage",photo as File);const failed=await uploadInspectionPhotos(db,profile.organization_id,response.data,photos);if(failed.length)return {success:false,error:"Conferência salva; a foto ainda não foi enviada. Tente novamente para completar a evidência."};}
 // T2-D01: when the damage photo still has to be sent by the browser (direct Storage transport), do NOT
 // revalidate here. Any revalidation makes Next re-render the current pickup/return page in this response,
 // which redirects to the evidence page and unmounts the form before the photo is sent — a failed upload
 // then went unnoticed. The client navigates/refreshes only after the photo has been attested.
 const photoStillPending=damage&&form.get("photo_upload_pending")==="true";
 if(!photoStillPending){revalidatePath("/gate");revalidatePath(`/reservations/${id}`);revalidatePath("/trips");}
 return {success:true,inspectionId:response.data};
}
