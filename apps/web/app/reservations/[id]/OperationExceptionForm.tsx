'use client';
import {useActionState,useEffect,useRef,useState} from 'react';
import {closeDeniedDeparture,type ExceptionResult} from './exceptionAction';
import {exceptionText} from '@/lib/operations/exceptionText';
import type {Locale} from '@/lib/i18n/locales';
const initial:ExceptionResult={status:'idle'};
export function OperationExceptionForm({reservationId,requestId,locale}:{reservationId:string;requestId:string;locale:Locale}){
 const [state,action,pending]=useActionState(closeDeniedDeparture,initial);const [reason,setReason]=useState('');const [confirmed,setConfirmed]=useState(false);const t=exceptionText(locale);
 // S3-07: React 19 resets the <form> after every action; a controlled checkbox keeps its state but the DOM box was
 // cleared, so the user saw it unchecked after a server error. Re-apply the kept state to the DOM after each result.
 const confirmRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(confirmRef.current&&confirmRef.current.checked!==confirmed)confirmRef.current.checked=confirmed;},[state,confirmed]);
 return <details className="fm-panel"><summary>{t.title}</summary><p>{t.help}</p>
 {state.message?<p role={state.status==='error'?'alert':'status'}>{state.message}</p>:null}
 {state.status!=='success'?<form action={action} onReset={event=>event.preventDefault()} className="fm-form">
 <input type="hidden" name="reservation_id" value={reservationId}/><input type="hidden" name="request_id" value={requestId}/>
 <label>{t.reason}<textarea name="reason" value={reason} onChange={e=>setReason(e.target.value)} required minLength={3} maxLength={1000}/></label>
 <label><input ref={confirmRef} type="checkbox" name="not_departed" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/>{t.confirm}</label>
 <button className="fm-btn fm-btn-danger" type="submit" disabled={pending}>{t.submit}</button>
 </form>:null}</details>;
}
