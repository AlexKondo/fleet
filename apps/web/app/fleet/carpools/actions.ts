"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {loadKeySession} from "@/lib/operations/keyCustodyLoad";
import {acceptCarpoolRequest,rejectCarpoolRequest} from "@/app/carpool/requestActions";
import {isUuid} from "@/lib/carpool/rpcErrors";
export async function managePassenger(form:FormData):Promise<void>{
 const {profile}=await loadKeySession();
 if(!["fleet_manager","administrator"].includes(profile.role))redirect("/dashboard");
 const id=String(form.get("request_id")??""),offer=String(form.get("offer")??""),action=form.get("decision");
 if(!isUuid(id)||!isUuid(offer)||(action!=="accept"&&action!=="reject"))redirect("/fleet/carpools?error=invalid_input");
 // Existing RPC checks organization, management scope, own request, state and atomic seat accounting.
 const result=action==="accept"?await acceptCarpoolRequest(id):await rejectCarpoolRequest(id,String(form.get("reason")??""));
 revalidatePath("/fleet/carpools");
 const back=new URLSearchParams({offer});
 for(const key of ["tab","q","day","destination","period","status","page","unit"]){const value=form.get(key);if(typeof value==="string")back.set(key,value.slice(0,500));}
 redirect(`/fleet/carpools?${back}&${result.status==="error"?`error=${encodeURIComponent(result.error)}`:"success=1"}`);
}
