import type {TypedSupabaseClient} from "@fleet/supabase-client";
const flags=["pickup_traveler","pickup_security","return_traveler","return_security","departed","arrived","own_pickup","own_return","legacy_pickup","can_pickup","can_return"] as const;
export type ChecklistState=Record<typeof flags[number],boolean>&{inspection_role:"traveler"|"security"|null;own_pickup_id:string|null;own_return_id:string|null;workflow?:"gate_visual"|"key_custody";keys_delivered?:boolean;keys_received?:boolean};
export function parseChecklistState(value:unknown):ChecklistState|null{
 if(!value || typeof value!=="object" || Array.isArray(value))return null;
 const row=value as Record<string,unknown>;
 if(row.workflow!==undefined && row.workflow!=="gate_visual" && row.workflow!=="key_custody")return null;
 if(row.workflow==="key_custody" && (typeof row.keys_delivered!=="boolean" || typeof row.keys_received!=="boolean"))return null;
 if(flags.some(k=>typeof row[k]!=="boolean"))return null;
 if(row.inspection_role!==null && row.inspection_role!=="traveler" && row.inspection_role!=="security")return null;
 for(const key of ["own_pickup_id","own_return_id"]){if(row[key]!==null && (typeof row[key]!=="string" || !/^[0-9a-f-]{36}$/i.test(row[key] as string)))return null;}
 return row as ChecklistState;
}
export async function loadChecklistState(db:TypedSupabaseClient,id:string):Promise<ChecklistState|null>{
 try{const {data,error}=await db.rpc("fm_checklist_state",{p_reservation_id:id});return error?null:parseChecklistState(data);}catch{return null;}
}
export function gateAction(state:ChecklistState|null|undefined):"pickup"|"return"|"movement"|"arrival"|"waiting"{
 if(!state)return "waiting";
 if(state.workflow==="key_custody")return "waiting";
 if(state.legacy_pickup && state.can_return)return "return";
 if(state.can_pickup)return "pickup";
 if(state.can_return)return "return";
 if(state.pickup_traveler && state.pickup_security && !state.departed)return "movement";
 if(state.departed && !state.arrived)return "arrival";
 return "waiting";
}
export async function loadGateChecklistStates(db:TypedSupabaseClient,ids:string[]):Promise<Map<string,ChecklistState>|null>{
 try{
  const {data,error}=await db.rpc("fm_gate_checklist_states",{p_reservation_ids:ids});
  if(error || !data || typeof data!=="object" || Array.isArray(data))return null;
  const result=new Map<string,ChecklistState>();
  for(const id of ids){const state=parseChecklistState(data[id]);if(!state)return null;result.set(id,state);}
  return result;
 }catch{return null;}
}
export async function loadMyChecklistStates(db:TypedSupabaseClient,ids:string[]):Promise<Map<string,ChecklistState>|null>{
 const result=new Map<string,ChecklistState>();
 try{
  for(let i=0;i<ids.length;i+=100){
   const batch=ids.slice(i,i+100);const {data,error}=await db.rpc("fm_my_checklist_states",{p_reservation_ids:batch});
   if(error || !data || typeof data!=="object" || Array.isArray(data))return null;
   for(const id of batch){const state=parseChecklistState(data[id]);if(!state)return null;result.set(id,state);}
  }
  return result;
 }catch{return null;}
}
