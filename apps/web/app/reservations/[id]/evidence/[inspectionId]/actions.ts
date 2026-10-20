"use server";
import {revalidatePath} from "next/cache";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {getCurrentUser} from "@/lib/auth/currentUser";
import {ALL_PHOTO_ANGLES,type PhotoAngle} from "@/lib/domain/checklist";
import {uploadInspectionPhotos} from "@/lib/domain/uploadInspectionPhotos";
export type EvidenceResult={status:"idle"|"success"|"error";message?:string};
export async function appendEvidence(_prior:EvidenceResult,form:FormData):Promise<EvidenceResult>{
 const db=await createSupabaseServerClient();const user=await getCurrentUser(db);
 if(!user)return {status:"error",message:"Entre novamente para continuar."};
 const inspection=String(form.get("inspectionId")??"");const reservation=String(form.get("reservationId")??"");
 const angle=String(form.get("angle")??"");
 if(!ALL_PHOTO_ANGLES.includes(angle as PhotoAngle))return {status:"error",message:"Selecione o tipo de foto."};
 const {data,error}=await db.from("inspections").select("id,organization_id,reservation_id,performed_by").eq("id",inspection).eq("reservation_id",reservation).eq("performed_by",user.id).single();
 if(error||!data)return {status:"error",message:"Este checklist não está disponível para seu perfil."};
 const photos=new FormData();const files=form.getAll("files").filter((f):f is File=>f instanceof File && f.size>0);
 if(!files.length)return {status:"error",message:"Selecione ao menos uma foto."};
 if(files.reduce((sum,file)=>sum+file.size,0)>5*1024*1024)return {status:"error",message:"Selecione fotos que totalizem até 5 MB. Você pode adicionar outras fotos em outro envio."};
 for(const file of files)photos.append(`photo_${angle}`,file);
 const failed=await uploadInspectionPhotos(db,data.organization_id,data.id,photos);
 revalidatePath(`/reservations/${reservation}`);revalidatePath(`/reservations/${reservation}/evidence/${inspection}`);revalidatePath("/gate");
 return failed.length?{status:"error",message:"Não foi possível salvar todas as fotos. As fotos já salvas foram preservadas; tente novamente."}:{status:"success",message:"Fotos adicionadas. Os registros anteriores foram preservados."};
}
