import type {TypedSupabaseClient} from "@fleet/supabase-client";
export type ManagementScope={mode:"all_units"|"selected_units";units:{id:string;name:string;enabled:boolean}[];vehicle_ids:string[]};
export type ScopeManager={id:string;name:string;enabled:boolean;mode:ManagementScope["mode"];version:number;unit_ids:string[]};
export type ScopeAdminSnapshot={units:ManagementScope["units"];managers:ScopeManager[];history:{id:string;user_id:string;mode:ManagementScope["mode"];unit_ids:string[];version:number;actor_id:string|null;source:string;reason:string;created_at:string}[]};
type Row=Record<string,unknown>;
const row=(v:unknown):v is Row=>!!v&&typeof v==="object"&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const mode=(v:unknown)=>v==="all_units"||v==="selected_units";
const ids=(v:unknown)=>Array.isArray(v)&&v.every(uuid);
const units=(v:unknown)=>Array.isArray(v)&&v.every(u=>row(u)&&uuid(u.id)&&typeof u.name==="string"&&typeof u.enabled==="boolean");
export function parseManagementScope(v:unknown):ManagementScope|null{
 return row(v)&&mode(v.mode)&&units(v.units)&&ids(v.vehicle_ids)?v as unknown as ManagementScope:null;
}
export function parseScopeAdminSnapshot(v:unknown):ScopeAdminSnapshot|null{
 if(!row(v)||!units(v.units)||!Array.isArray(v.managers)||!v.managers.every(m=>row(m)&&uuid(m.id)&&typeof m.name==="string"&&typeof m.enabled==="boolean"&&mode(m.mode)&&Number.isSafeInteger(m.version)&&(m.version as number)>=0&&ids(m.unit_ids)))return null;
 if(!Array.isArray(v.history)||!v.history.every(h=>row(h)&&uuid(h.id)&&uuid(h.user_id)&&mode(h.mode)&&ids(h.unit_ids)&&Number.isSafeInteger(h.version)&&(h.actor_id===null||uuid(h.actor_id))&&typeof h.source==="string"&&typeof h.reason==="string"&&typeof h.created_at==="string"&&Number.isFinite(Date.parse(h.created_at))))return null;
 return v as unknown as ScopeAdminSnapshot;
}
export async function loadManagementScope(db:TypedSupabaseClient):Promise<ManagementScope|null>{
 try{const {data,error}=await db.rpc("fm_my_management_scope");return error?null:parseManagementScope(data);}catch{return null;}
}
