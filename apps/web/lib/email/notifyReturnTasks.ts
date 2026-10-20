import "server-only";
import type {TypedSupabaseClient} from "@fleet/supabase-client";
import {getFleetManagerEmails} from "./recipients";
import {renderEmail} from "./renderEmail";
import {sendEmail} from "./sendEmail";
import {getAppUrl} from "@/lib/getAppUrl";
/** The durable notification is recorded in SQL. A failed SMTP attempt must not
 * make an already committed checklist/key receipt appear to have failed. */
export async function notifyReturnTasks(db:TypedSupabaseClient,reservationId:string,organizationId:string){
 try{
  const {data,error}=await db.rpc("fm_claim_return_notice",{p_reservation_id:reservationId});
  if(error||data!==true)return;
  const to=await getFleetManagerEmails(db,organizationId);if(!to.length)return;
  const {html,text}=renderEmail({heading:"Novas tarefas operacionais",bodyLines:["Uma devolução de veículo gerou novas tarefas operacionais."],ctaLabel:"Abrir Painel",ctaUrl:`${getAppUrl()}/dashboard`});
  await sendEmail({to,subject:"Novas tarefas operacionais",html,text});
 }catch{ /* best effort only; no false rollback of a committed operation */ }
}
