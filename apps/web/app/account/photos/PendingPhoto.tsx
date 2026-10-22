'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {directPhotoUpload} from '@/lib/domain/directPhotoUpload';
import type {PhotoAngle} from '@/lib/domain/checklist';
import type {PhotoRecoveryText} from '@/lib/domain/photoRecoveryText';
import {restartPhoto} from './actions';
export interface PendingItem{id:string;target_kind:'vehicle'|'inspection';target_id:string;angle:PhotoAngle|null;sha256:string;created_at:string}
export function PendingPhoto({item,t}:{item:PendingItem;t:PhotoRecoveryText}){
 const [file,setFile]=useState<File|null>(null);const [message,setMessage]=useState('');const [pending,start]=useTransition();const router=useRouter();
 return <article className="fm-card"><p>{t.help}</p><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)} disabled={pending}/>
 <button className="fm-btn" disabled={!file||pending} onClick={()=>start(async()=>{if(!file)return;setMessage('');try{if(file.size<1||file.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)){setMessage(t.wrong);return;}const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');if(sha!==item.sha256){setMessage(t.wrong);return;}await directPhotoUpload(item.target_kind,item.target_id,item.angle,file);setMessage(t.done);router.refresh();}catch{setMessage(t.failed);}})}>{t.retry}</button>
 <button className="fm-btn fm-btn-ghost" disabled={pending} onClick={()=>start(async()=>{try{const result=await restartPhoto(item.id);setMessage(result.success?t.ready:t.failed);router.refresh();}catch{setMessage(t.failed)}})}>{t.restart}</button>
 {message?<p role="status">{message}</p>:null}</article>;
}
