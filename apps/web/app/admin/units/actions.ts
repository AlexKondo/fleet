"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {loadKeySession} from "@/lib/operations/keyCustodyLoad";
import {keyErrorCode} from "@/lib/operations/keyCustody";
export async function saveUnitConfiguration(form:FormData){
 const {db}=await loadKeySession(true);let failure:string|null=null;
 const command=String(form.get("command"));const reason=String(form.get("reason")??"").trim();
 const version=Number(form.get("version"));
 const common={version,reason};
 const payload=command==="unit.save"?{...common,id:String(form.get("id")??""),name:String(form.get("name")??""),enabled:form.get("enabled")==="on",workflow:String(form.get("workflow"))}
 :command==="unit.vehicle"?{...common,vehicle_id:String(form.get("vehicle_id")),unit_id:String(form.get("unit_id"))}
 :{...common,user_id:String(form.get("user_id")),unit_id:String(form.get("unit_id")),enabled:form.get("enabled")==="true"};
 try{
  if(!["unit.save","unit.vehicle","unit.custodian"].includes(command)||!Number.isSafeInteger(version)||version<0)throw new Error("INVALID_INPUT");
  const {error}=await db.rpc("fm_unit_admin_command",{p_command:command,p_payload:payload,p_request_id:String(form.get("request_id"))});
  if(error)failure=keyErrorCode(error.message);
 }catch(e){failure=e instanceof Error?keyErrorCode(e.message):"UNAVAILABLE";}
 if(!failure){revalidatePath("/admin/units");revalidatePath("/account/keys");}
 redirect(`/admin/units?${failure?`error=${failure}`:"success=1"}`);
}

export async function saveManagerScope(form:FormData){
 const {db}=await loadKeySession(true);let failure:string|null=null;
 try{
  const version=Number(form.get("version"));
  const mode=String(form.get("mode"));
  if(!Number.isSafeInteger(version)||version<0||!["all_units","selected_units"].includes(mode))throw new Error("INVALID_INPUT");
  const {error}=await db.rpc("fm_manager_scope_command",{
   p_user_id:String(form.get("user_id")),p_mode:mode,
   p_unit_ids:mode==="selected_units"?form.getAll("unit_ids").map(String):[],
   p_version:version,p_reason:String(form.get("reason")??"").trim(),p_request_id:String(form.get("request_id")),
  });
  if(error)failure=keyErrorCode(error.message);
 }catch(e){failure=e instanceof Error?keyErrorCode(e.message):"UNAVAILABLE";}
 if(!failure){revalidatePath("/admin/units");revalidatePath("/fleet","layout");revalidatePath("/dashboard","layout");}
 redirect(`/admin/units?${failure?`error=${failure}`:"success=1"}`);
}

export async function saveMaintenancePolicy(form:FormData){
 const {db}=await loadKeySession(true);let failure:string|null=null;
 try{
  const version=Number(form.get("version"));const mode=String(form.get("mode"));
  if(!Number.isSafeInteger(version)||version<0||!["scoped_managers","designated"].includes(mode))throw new Error("INVALID_INPUT");
  const {error}=await db.rpc("fm_maintenance_policy_save",{p_unit_id:String(form.get("unit_id")),p_mode:mode,p_approver_ids:mode==="designated"?form.getAll("approver_ids").map(String):[],p_superior_ids:form.getAll("superior_ids").map(String),p_version:version,p_reason:String(form.get("reason")??"").trim(),p_request_id:String(form.get("request_id"))});
  if(error)failure=keyErrorCode(error.message);
 }catch(e){failure=e instanceof Error?keyErrorCode(e.message):"UNAVAILABLE";}
 if(!failure){revalidatePath("/admin/units");revalidatePath("/maintenance","layout");revalidatePath("/fleet/maintenance");}
 redirect(`/admin/units?${failure?`error=${failure}`:"success=1"}`);
}
