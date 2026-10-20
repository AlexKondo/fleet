"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {loadKeySession} from "@/lib/operations/keyCustodyLoad";
import {keyErrorCode} from "@/lib/operations/keyCustody";
import {notifyReturnTasks} from "@/lib/email/notifyReturnTasks";
export async function confirmKeys(form:FormData){
 const {db,profile}=await loadKeySession();let failure:string|null=null;
 try{
  if(form.get("physical_confirmation")!=="on")throw new Error("INVALID_INPUT");
  const {error}=await db.rpc("fm_key_command",{p_reservation_id:String(form.get("reservation_id")),p_kind:String(form.get("kind")),p_reason:String(form.get("reason")??"").trim()||null,p_request_id:String(form.get("request_id"))});
  if(error)failure=keyErrorCode(error.message);
 }catch(e){failure=e instanceof Error?keyErrorCode(e.message):"UNAVAILABLE";}
 if(!failure){
  if(form.get("kind")==="received")await notifyReturnTasks(db,String(form.get("reservation_id")),profile.organization_id);
  revalidatePath("/account/keys");revalidatePath("/trips");revalidatePath("/reservations","layout");revalidatePath("/dashboard/command-center");
 }
 redirect(`/account/keys?${failure?`error=${failure}`:"success=1"}`);
}
