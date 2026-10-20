import type {TypedSupabaseClient} from '@fleet/supabase-client';
export type UnitDimension={units:{id:string;name:string;enabled:boolean}[];bindings:{vehicle_id:string;unit_id:string}[]};
export function parseUnitDimension(v:unknown):UnitDimension|null{
 if(!v||typeof v!=='object')return null;const d=v as UnitDimension;
 if(!Array.isArray(d.units)||!d.units.every(u=>u&&typeof u.id==='string'&&typeof u.name==='string'&&typeof u.enabled==='boolean')||!Array.isArray(d.bindings)||!d.bindings.every(b=>b&&typeof b.vehicle_id==='string'&&d.units.some(u=>u.id===b.unit_id)))return null;
 return d;
}
export async function loadUnitDimension(db:TypedSupabaseClient):Promise<UnitDimension|null>{try{const r=await db.rpc('fm_management_unit_dimension');return r.error?null:parseUnitDimension(r.data);}catch{return null;}}
