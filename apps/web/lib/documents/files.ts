import {createHash} from 'node:crypto';
export const MAX_DOCUMENT_BYTES=5*1024*1024;
export const DOCUMENT_MIMES=['application/pdf','image/jpeg','image/png','image/webp'] as const;
export function documentFilename(name:string):string{
 const clean=name.replace(/[\u0000-\u001f\u007f/\\]/g,'_').trim().slice(0,180);
 if(!clean||clean==='.'||clean==='..')throw new Error('INVALID_DOCUMENT');return clean;
}
export function validateDocument(bytes:Uint8Array,mime:string){
 if(bytes.length<4||bytes.length>MAX_DOCUMENT_BYTES)throw new Error('INVALID_DOCUMENT');
 const b=Buffer.from(bytes);const valid=mime==='application/pdf'?b.subarray(0,5).equals(Buffer.from('%PDF-'))
 :mime==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255
 :mime==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
 :mime==='image/webp'?b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP':false;
 if(!valid)throw new Error('INVALID_DOCUMENT');
 return createHash('sha256').update(bytes).digest('hex');
}
export type DocumentRecord={id:string;organization_id:string;target_kind:string;target_id:string;category:string;filename:string;mime_type:string;size_bytes:number;sha256:string;storage_path:string;state:'pending'|'ready'|'invalidated';version:number;request_id:string;created_at:string;invalidation_reason:string|null;can_invalidate?:boolean};
export function parseDocument(value:unknown):DocumentRecord|null{
 if(!value||typeof value!=='object')return null;const d=value as Record<string,unknown>;
 if(!['id','organization_id','target_id','request_id'].every(k=>typeof d[k]==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(d[k])))||typeof d.filename!=='string'||typeof d.storage_path!=='string'||typeof d.sha256!=='string'||!/^[0-9a-f]{64}$/.test(d.sha256)||!DOCUMENT_MIMES.includes(d.mime_type as typeof DOCUMENT_MIMES[number])||!Number.isSafeInteger(d.size_bytes)||(d.size_bytes as number)<1||(d.size_bytes as number)>MAX_DOCUMENT_BYTES||!Number.isSafeInteger(d.version)||!['pending','ready','invalidated'].includes(String(d.state))||!['vehicle','work_order','energy_event'].includes(String(d.target_kind)))return null;
 return d as unknown as DocumentRecord;
}
export function parseDocumentList(v:unknown):{can_upload:boolean;documents:DocumentRecord[]}|null{
 if(!v||typeof v!=='object'||!('documents' in v)||!Array.isArray(v.documents)||!('can_upload' in v)||typeof v.can_upload!=='boolean')return null;
 const docs=v.documents.map(parseDocument);return docs.some(d=>d===null)?null:{can_upload:v.can_upload,documents:docs as DocumentRecord[]};
}
export function documentTarget(form:FormData|{target?:string;id?:string}){
 const target=form instanceof FormData?String(form.get('target')??''):form.target??'';
 const id=form instanceof FormData?String(form.get('id')??''):form.id??'';
 if(!['vehicle','work_order','energy_event'].includes(target)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('INVALID_INPUT');return {target,id};
}
