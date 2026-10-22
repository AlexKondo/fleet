'use client';
import {createSupabaseBrowserClient} from '@/lib/supabase/client';
import {ALL_PHOTO_ANGLES,type PhotoAngle} from './checklist';
async function command(body:Record<string,unknown>){const r=await fetch('/api/photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('PHOTO_LINK_PENDING');return r.json();}
/** Browser -> private Storage under user RLS. Only small JSON reaches application routes. */
export async function directPhotoUpload(kind:'vehicle'|'inspection',target:string,angle:PhotoAngle|null,file:File){
 if(file.size<1||file.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('INVALID_PHOTO');
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
 const j=await command({phase:'begin',kind,target,angle,sha,size:file.size,mime:file.type});
 if(j.state!=='linked')await createSupabaseBrowserClient().storage.from('vehicle-photos').upload(j.path,file,{upsert:false,contentType:file.type});
 await command({phase:'finish',id:j.id});
}
export function fieldsWithoutPhotos(data:FormData){const copy=new FormData();for(const [key,value] of data)if(!(value instanceof File))copy.append(key,value);return copy;}
export async function directInspectionPhotos(id:string,data:FormData):Promise<PhotoAngle[]>{
 const failed=new Set<PhotoAngle>();
 for(const angle of ALL_PHOTO_ANGLES)for(const file of data.getAll(`photo_${angle}`))if(file instanceof File&&file.size){try{await directPhotoUpload('inspection',id,angle,file)}catch{failed.add(angle)}}
 return [...failed];
}
