"use client";
import {useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {submitVisualCheck} from "./visualActions";
import type {Dictionary} from "@/lib/i18n/dictionaries";
export function GateVisualForm({reservationId,phase,dict}:{reservationId:string;phase:"pickup"|"return";dict:Dictionary}){
 const [damage,setDamage]=useState(false);const [error,setError]=useState<string|null>(null);const [pending,start]=useTransition();const router=useRouter();const t=dict.ops.gate;
 return <form className="fm-card ck-card" action={form=>start(async()=>{setError(null);const result=await submitVisualCheck(form);if(result.success){router.push("/gate");router.refresh();}else setError(result.error??dict.errors.common.generic);})}>
  <h2 className="fm-h2">{t.visualTitle}</h2><p className="fm-muted">{t.visualDescription}</p>
  <input type="hidden" name="reservationId" value={reservationId}/><input type="hidden" name="phase" value={phase}/>
  <label className="fm-field"><span><input type="checkbox" name="hasDamage" checked={damage} onChange={e=>setDamage(e.target.checked)}/> {t.observedDamage}</span></label>
  {damage?<><textarea name="notes" required maxLength={3000} aria-label={dict.reservations.checklist.damageNotesPlaceholder} placeholder={dict.reservations.checklist.damageNotesPlaceholder}/><input type="file" name="photo_damage" accept="image/*" capture="environment" required aria-label={dict.reservations.checklist.damagePhotoRequired} onChange={e=>e.currentTarget.setCustomValidity((e.currentTarget.files?.[0]?.size??0)>5*1024*1024?"A foto deve ter até 5 MB.":"")}/></>:null}
  {error?<p role="alert">{error}</p>:null}<button className="fm-btn fm-btn-primary" type="submit" disabled={pending}>{pending?dict.reservations.checklist.submitting:t.confirmVisual}</button>
 </form>;
}
