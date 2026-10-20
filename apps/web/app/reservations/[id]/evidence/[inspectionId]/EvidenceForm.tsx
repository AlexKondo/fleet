"use client";
import {useActionState} from "react";
import {ALL_PHOTO_ANGLES} from "@/lib/domain/checklist";
import {appendEvidence,type EvidenceResult} from "./actions";
const labels={front:"Frente",back:"Traseira",left_side:"Lado esquerdo",right_side:"Lado direito",wheels:"Rodas",interior:"Interior",damage:"Dano observado"};
export function EvidenceForm({inspectionId,reservationId}:{inspectionId:string;reservationId:string}){
 const [state,action,pending]=useActionState(appendEvidence,{status:"idle"} as EvidenceResult);
 return <form action={action} className="fm-card ck-card">
  <input type="hidden" name="inspectionId" value={inspectionId}/><input type="hidden" name="reservationId" value={reservationId}/>
  <label className="fm-field"><span className="fm-label">Tipo de foto</span><select name="angle" required className="fm-input">{ALL_PHOTO_ANGLES.map(a=><option value={a} key={a}>{labels[a]}</option>)}</select></label>
  <label className="fm-field"><span className="fm-label">Fotos adicionais · até 5 MB por envio</span><input name="files" type="file" accept="image/*" multiple required disabled={pending} onChange={e=>e.currentTarget.setCustomValidity(Array.from(e.currentTarget.files??[]).reduce((sum,f)=>sum+f.size,0)>5*1024*1024?"Selecione fotos que totalizem até 5 MB. Você pode adicionar outras fotos em outro envio.":"")}/></label>
  {state.message?<p role={state.status==="error"?"alert":"status"}>{state.message}</p>:null}
  <button type="submit" className="fm-btn fm-btn-primary" disabled={pending}>{pending?"Salvando…":"Adicionar fotos"}</button>
 </form>;
}
