import type {TypedSupabaseClient} from '@fleet/supabase-client';
export type EquipmentContract={id:string;source:'vehicle'|'category'|'legacy_return_observation';configuration_version:number;required_names:string[];optional_names:string[]};
export function parseEquipmentContract(v:unknown):EquipmentContract|null{
 if(!v||typeof v!=='object')return null;const r=v as Record<string,unknown>;
 return typeof r.id==='string'&&['vehicle','category','legacy_return_observation'].includes(String(r.source))&&Number.isSafeInteger(r.configuration_version)&&Array.isArray(r.required_names)&&r.required_names.every(n=>typeof n==='string')&&Array.isArray(r.optional_names)&&r.optional_names.every(n=>typeof n==='string')?r as EquipmentContract:null;
}
export async function loadEquipmentContract(db:TypedSupabaseClient,reservationId:string){
 try{const {data,error}=await db.rpc('fm_prepare_equipment_checklist',{p_reservation_id:reservationId});return error?null:parseEquipmentContract(data);}catch{return null;}
}
export type EquipmentProfile={target_kind:'vehicle'|'category';target_id:string;enabled:boolean;required_ids:string[];optional_ids:string[];version:number};
export type EquipmentSnapshot={vehicle:{id:string;plate:string;category_id:string};can_edit:boolean;can_edit_category:boolean;effective:{configured:boolean;source?:string;version?:number;required?:{id:string;name:string}[];optional?:{id:string;name:string}[]};profiles:EquipmentProfile[];catalog:{id:string;name:string;enabled:boolean}[]};
export function parseEquipmentSnapshot(v:unknown):EquipmentSnapshot|null{
 if(!v||typeof v!=='object')return null;const s=v as EquipmentSnapshot;
 if(!s.vehicle||typeof s.vehicle.id!=='string'||typeof s.vehicle.plate!=='string'||typeof s.vehicle.category_id!=='string'||typeof s.can_edit!=='boolean'||typeof s.can_edit_category!=='boolean'||!s.effective||typeof s.effective.configured!=='boolean'||!Array.isArray(s.profiles)||!Array.isArray(s.catalog))return null;
 if(!s.profiles.every(p=>p&&['vehicle','category'].includes(p.target_kind)&&typeof p.target_id==='string'&&typeof p.enabled==='boolean'&&Number.isSafeInteger(p.version)&&p.version>0&&Array.isArray(p.required_ids)&&p.required_ids.every(id=>typeof id==='string')&&Array.isArray(p.optional_ids)&&p.optional_ids.every(id=>typeof id==='string'))||!s.catalog.every(e=>e&&typeof e.id==='string'&&typeof e.name==='string'&&typeof e.enabled==='boolean'))return null;
 if(s.effective.configured&&(!Array.isArray(s.effective.required)||!Array.isArray(s.effective.optional)||![...s.effective.required,...s.effective.optional].every(e=>e&&typeof e.id==='string'&&typeof e.name==='string')))return null;return s;
}
