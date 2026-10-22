"use client";
import {fieldsWithoutPhotos,directInspectionPhotos} from "@/lib/domain/directPhotoUpload";
import {useRef,useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {submitVisualCheck} from "./visualActions";
import type {Dictionary} from "@/lib/i18n/dictionaries";
const GATE_PHOTO_MAX=5*1024*1024;
const GATE_PHOTO_TYPES=["image/jpeg","image/png","image/webp"];
/** Client-side check of the damage photo BEFORE the visual check is recorded, so an unsupported
 * file (e.g. HEIC) never produces a saved "damage without photo" check. */
export function gateDamagePhotoProblem(file:unknown):"missing"|"type"|"size"|null{
 if(!(file instanceof File)||file.size===0)return "missing";
 if(!GATE_PHOTO_TYPES.includes(file.type))return "type";
 if(file.size>GATE_PHOTO_MAX)return "size";
 return null;
}
export function GateVisualForm({reservationId,phase,dict}:{reservationId:string;phase:"pickup"|"return";dict:Dictionary}){
 const [damage,setDamage]=useState(false);const [error,setError]=useState<string|null>(null);const [pending,start]=useTransition();const router=useRouter();const t=dict.ops.gate;
 // T2-D01: once the check is saved but the damage photo failed, keep the original form data (with the
 // file) and the inspection id, so only the photo is retried — the check is never recorded twice.
 const [savedInspection,setSavedInspection]=useState<string|null>(null);const saved=useRef<FormData|null>(null);
 const finish=()=>{router.push("/gate");router.refresh();};
 const sendPhoto=async(inspectionId:string,form:FormData)=>{
  let failed=true;try{failed=(await directInspectionPhotos(inspectionId,form)).length>0;}catch{failed=true;}
  if(failed){saved.current=form;setSavedInspection(inspectionId);setError(t.damagePhotoFailed);return;}
  saved.current=null;setSavedInspection(null);finish();
 };
 return <form className="fm-card ck-card" onSubmit={event=>{event.preventDefault();if(savedInspection)return;const form=new FormData(event.currentTarget);
  if(damage){const problem=gateDamagePhotoProblem(form.get("photo_damage"));if(problem==="type"){setError(t.damagePhotoType);return;}if(problem==="size"){setError(t.damagePhotoTooLarge);return;}}
  start(async()=>{setError(null);const fields=fieldsWithoutPhotos(form);fields.set("photo_upload_pending","true");const result=await submitVisualCheck(fields);
   if(!result.success){setError(result.error??dict.errors.common.generic);return;}
   if(result.inspectionId&&damage){await sendPhoto(result.inspectionId,form);return;}
   finish();});}}>
  <h2 className="fm-h2">{t.visualTitle}</h2><p className="fm-muted">{t.visualDescription}</p>
  <input type="hidden" name="reservationId" value={reservationId}/><input type="hidden" name="phase" value={phase}/>
  <label className="fm-field"><span><input type="checkbox" name="hasDamage" checked={damage} disabled={!!savedInspection} onChange={e=>setDamage(e.target.checked)}/> {t.observedDamage}</span></label>
  {damage?<><textarea name="notes" required maxLength={3000} readOnly={!!savedInspection} aria-label={dict.reservations.checklist.damageNotesPlaceholder} placeholder={dict.reservations.checklist.damageNotesPlaceholder}/><input type="file" name="photo_damage" accept="image/jpeg,image/png,image/webp" capture="environment" required disabled={!!savedInspection} aria-label={dict.reservations.checklist.damagePhotoRequired} onChange={e=>{const problem=gateDamagePhotoProblem(e.currentTarget.files?.[0]);const message=problem==="type"?t.damagePhotoType:problem==="size"?t.damagePhotoTooLarge:null;e.currentTarget.setCustomValidity(message??"");setError(message);}}/></>:null}
  {error?<div role="alert" className="fm-banner fm-banner-danger ck-msg"><p>{error}</p>{savedInspection?<p><Link href={`/reservations/${reservationId}/evidence/${savedInspection}`}>{t.openEvidence}</Link></p>:null}</div>:null}
  {savedInspection
   ?<button className="fm-btn fm-btn-primary" type="button" disabled={pending} onClick={()=>{const form=saved.current;const id=savedInspection;if(!form||!id)return;start(async()=>{setError(null);await sendPhoto(id,form);});}}>{pending?dict.reservations.checklist.submitting:t.retryDamagePhoto}</button>
   :<button className="fm-btn fm-btn-primary" type="submit" disabled={pending}>{pending?dict.reservations.checklist.submitting:t.confirmVisual}</button>}
 </form>;
}
