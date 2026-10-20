"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {loadKeySession} from "@/lib/operations/keyCustodyLoad";
import {isUuid} from "@/lib/carpool/rpcErrors";
export async function incidentCommand(form:FormData):Promise<void>{
 const {db}=await loadKeySession();const command=String(form.get("command")??""),request=String(form.get("request_id")??"");
 const payload:Record<string,string|number>={};let invalid=!isUuid(request);
 for(const field of ['id','vehicle_id','inspection_id','reservation_id','assignee_id','work_order_id','kind','severity','title','notes']){
  const value=form.get(field);if(typeof value==='string'){if(value.length>3000)invalid=true;payload[field]=value;}
 }
 if(command!=='create')payload.version=Number(form.get('version'));
 const result=invalid?null:await db.rpc('fm_incident_command',{p_command:command,p_payload:payload,p_request_id:request});
 if(!result||result.error){const code=/CONCURRENT_UPDATE|LINKED_WORK_ORDER_PENDING|INVALID_STATE_TRANSITION|INVALID_REFERENCE|NOT_AUTHORIZED|IDEMPOTENCY_CONFLICT/.exec(result?.error?.message??'')?.[0]??'INVALID_INPUT';redirect(`/fleet/incidents?case=${isUuid(String(payload.id))?payload.id:''}&caseError=${code}`);}
 revalidatePath('/fleet/incidents');const value=result.data as {id?:string}|null;
 redirect(`/fleet/incidents?case=${value?.id&&isUuid(value.id)?value.id:''}&success=1`);
}
