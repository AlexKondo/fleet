import type { TypedSupabaseClient } from "@fleet/supabase-client";

/**
 * S3-04: who may SEE the "Regularizar saída impedida" form on /reservations/[id]. Mirrors the authorization of
 * fm_operation_exception (0211) for outcome 'not_departed', so the form is never offered to someone the RPC
 * will always refuse:
 *  - security: only in a gate_visual unit (the RPC refuses security in key_custody);
 *  - fleet_manager / administrator: only within their management scope. The page reads the reservation under
 *    the manager's own RLS (out-of-scope reservations are not readable and the page redirects), and the RPC
 *    re-checks fm_can_manage_reservation; `inScope` carries that page-level fact explicitly.
 *  - anyone else (requester, other employees, maintenance): never. Key custodians keep using their own screen.
 * The other display conditions (not own reservation, confirmed, checklist done, not departed) stay in the page.
 */
export function canShowOperationExceptionForm(input: {
  role: string | null | undefined;
  workflow: "gate_visual" | "key_custody" | undefined;
  inScope: boolean;
}): boolean {
  if (input.role === "security") return input.workflow === "gate_visual";
  if(input.workflow==="key_custody")return false;
  if (input.role === "fleet_manager" || input.role === "administrator") return input.inScope;
  return false;
}

/**
 * S3-05: whether this reservation was closed by an operation exception ("vehicle did not leave"). Read under the
 * viewer's RLS (fm_operation_exceptions_read: managers in scope, security and the actor). The table is not in the
 * generated types yet, hence the narrow untyped read. A failed read answers false (no notice), never an error.
 */
export async function loadNotDepartedException(db:TypedSupabaseClient,id:string):Promise<boolean>{try{const {data,error}=await db.rpc('fm_not_departed_reservations',{p_ids:[id]});return !error&&Array.isArray(data)&&data.includes(id);}catch{return false;}}
