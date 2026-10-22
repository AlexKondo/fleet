"use client";
import {directPhotoUpload} from "@/lib/domain/directPhotoUpload";
import type {PhotoAngle} from "@/lib/domain/checklist";
import {useActionState} from "react";
import {useRouter} from "next/navigation";
import {ALL_PHOTO_ANGLES} from "@/lib/domain/checklist";
import {type EvidenceResult} from "./actions";
const labels={front:"Frente",back:"Traseira",left_side:"Lado esquerdo",right_side:"Lado direito",wheels:"Rodas",interior:"Interior",damage:"Dano observado"};
const PHOTO_TYPES=["image/jpeg","image/png","image/webp"];
export function EvidenceForm({inspectionId,reservationId,defaultAngle,typeError}:{inspectionId:string;reservationId:string;defaultAngle?:PhotoAngle;typeError:string}){
 const router=useRouter();
 const [state,action,pending]=useActionState(async (_prev:EvidenceResult,data:FormData):Promise<EvidenceResult>=>{if(data.getAll("files").some(f=>f instanceof File&&f.size>0&&!PHOTO_TYPES.includes(f.type)))return {status:"error",message:typeError};try{for(const file of data.getAll("files"))if(file instanceof File&&file.size)await directPhotoUpload("inspection",inspectionId,String(data.get("angle")) as PhotoAngle,file);router.refresh();return {status:"success",message:"Fotos adicionadas; as evidências anteriores foram preservadas."};}catch{return {status:"error",message:"Foto pendente. Tente novamente ou consulte Minhas fotos pendentes na conta."};}},{status:"idle"} as EvidenceResult);
 return <form action={action} className="fm-card ck-card">
  <input type="hidden" name="inspectionId" value={inspectionId}/><input type="hidden" name="reservationId" value={reservationId}/>
  <label className="fm-field"><span className="fm-label">Tipo de foto</span><select name="angle" required className="fm-input" defaultValue={defaultAngle}>{ALL_PHOTO_ANGLES.map(a=><option value={a} key={a}>{labels[a]}</option>)}</select></label>
  <label className="fm-field"><span className="fm-label">Fotos adicionais · até 10 MB por foto</span><input name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple required disabled={pending} onChange={e=>e.currentTarget.setCustomValidity(Array.from(e.currentTarget.files??[]).some(f=>f.size>10*1024*1024)?"Cada foto deve ter até 10 MB.":"")}/></label>
  {state.message?<p role={state.status==="error"?"alert":"status"}>{state.message}</p>:null}
  <button type="submit" className="fm-btn fm-btn-primary" disabled={pending}>{pending?"Salvando…":"Adicionar fotos"}</button>
 </form>;
}
