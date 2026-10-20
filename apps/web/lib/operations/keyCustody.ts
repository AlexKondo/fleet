export type Unit = {id:string;name:string;enabled:boolean;workflow:"gate_visual"|"key_custody";version:number};
export type Custodian = {unit_id:string;user_id:string;enabled:boolean;version:number};
export type UnitVehicle = {id:string;plate:string;unit_id:string|null;version:number};
export type UnitPerson = {id:string;name:string;role:string;enabled:boolean};
export type UnitAdminState = {units:Unit[];assignments:Custodian[];vehicles:UnitVehicle[];people:UnitPerson[]};
export type KeyReservation = {id:string;unit_id:string;unit:string;plate:string;requester:string;self:boolean;start_at:string;end_at:string;status:string;delivered:boolean;received:boolean};
export type KeyEvent = {id:string;unit_id:string;unit:string;plate:string;reservation_id:string;kind:"delivered"|"received"|"exception";reason:string|null;created_at:string;actor:string};
export type KeyWorkspace = {units:{id:string;name:string}[];reservations:KeyReservation[];events:KeyEvent[]};
type Row=Record<string,unknown>;
const row=(v:unknown):v is Row=>!!v && typeof v==="object" && !Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=(v:unknown):v is string=>typeof v==="string" && v.length>0;
const version=(v:unknown):v is number=>Number.isSafeInteger(v) && (v as number)>=0;
const date=(v:unknown):v is string=>typeof v==="string" && Number.isFinite(Date.parse(v));
const rows=(v:unknown,valid:(r:Row)=>boolean)=>Array.isArray(v) && v.every(r=>row(r)&&valid(r));
export function parseUnitAdminState(v:unknown):UnitAdminState|null{
 if(!row(v) || !rows(v.units,r=>id(r.id)&&text(r.name)&&typeof r.enabled==="boolean"&&["gate_visual","key_custody"].includes(String(r.workflow))&&version(r.version))
 || !rows(v.assignments,r=>id(r.unit_id)&&id(r.user_id)&&typeof r.enabled==="boolean"&&version(r.version))
 || !rows(v.vehicles,r=>id(r.id)&&text(r.plate)&&(r.unit_id===null||id(r.unit_id))&&version(r.version))
 || !rows(v.people,r=>id(r.id)&&text(r.name)&&text(r.role)&&typeof r.enabled==="boolean"))return null;
 return v as unknown as UnitAdminState;
}
export function parseKeyWorkspace(v:unknown):KeyWorkspace|null{
 if(!row(v)||!rows(v.units,r=>id(r.id)&&text(r.name))||!rows(v.reservations,r=>id(r.id)&&id(r.unit_id)&&text(r.unit)&&text(r.plate)&&text(r.requester)&&typeof r.self==="boolean"&&date(r.start_at)&&date(r.end_at)&&text(r.status)&&typeof r.delivered==="boolean"&&typeof r.received==="boolean")
 ||!rows(v.events,r=>id(r.id)&&id(r.unit_id)&&id(r.reservation_id)&&text(r.unit)&&text(r.plate)&&text(r.actor)&&date(r.created_at)&&["delivered","received","exception"].includes(String(r.kind))&&(r.reason===null||typeof r.reason==="string")))return null;
 return v as unknown as KeyWorkspace;
}
const errors:Record<string,string>={
 MANAGEMENT_SCOPE_DENIED:"Você não possui autorização de gestão para a unidade-base deste veículo.",
 SELF_APPROVAL_DENIED:"Quem criou ou lançou o orçamento não pode aprová-lo. Encaminhe ao superior autorizado.",
 SUPERIOR_APPROVAL_REQUIRED:"Este orçamento exige aprovação de outro gestor superior designado para a unidade.",
 APPROVER_NOT_AUTHORIZED:"O aprovador deve estar ativo, autorizado para a unidade e previsto na política.",
 BUDGET_APPROVAL_PENDING:"A revisão do orçamento aguarda aprovação independente.",
 NOT_AUTHORIZED:"Você não tem autorização para esta ação.",
 NOT_FOUND:"Registro não encontrado no seu escopo.",
 KEY_CUSTODY_NOT_AUTHORIZED:"Sua designação não permite confirmar chaves nesta unidade. Recarregue a página.",
 INDEPENDENT_CUSTODIAN_REQUIRED:"Outra pessoa designada deve confirmar as chaves da sua própria reserva.",
 KEYS_OUTSTANDING:"Há chaves entregues sem confirmação de recebimento. Regularize a custódia antes de alterar esta configuração.",
 KEY_EVENT_ALREADY_RECORDED:"Essa confirmação já foi registrada. Recarregue para consultar o estado atual.",
 KEY_DELIVERY_REQUIRED:"A entrega das chaves ainda não foi confirmada.",
 ACCOUNT_DISABLED:"O usuário está desativado. Sua atribuição não pode ser habilitada.",
 ACTIVE_RESERVATION:"Há reserva pendente de aprovação ou confirmada para este veículo ou unidade. Essa alteração de operação deve aguardar a regularização das reservas.",
 CONCURRENT_UPDATE:"A configuração mudou. Recarregue a página antes de tentar novamente.",
 IDEMPOTENCY_CONFLICT:"Esta solicitação já foi usada com outros dados. Recarregue a página.",
 PICKUP_WINDOW_INVALID:"A entrega está fora da janela permitida para retirada.",
 DRIVER_NOT_AUTHORIZED:"O condutor precisa estar ativo e com autorização e CNH válidas.",
 VEHICLE_NOT_READY:"O veículo não está disponível para entrega das chaves. Consulte o gestor.",
 RESERVATION_NOT_CONFIRMED:"A reserva não está confirmada para retirada.",
 RESERVATION_WORKFLOW_MISMATCH:"A reserva segue outro processo operacional. Consulte o gestor.",
 INVALID_INPUT:"Confira os campos e a confirmação exigida para a operação.",
 REASON_REQUIRED:"Informe uma justificativa de pelo menos três caracteres.",
};
export function keyErrorCode(message:string):string{return Object.keys(errors).find(k=>message===k)||"UNAVAILABLE";}
export function keyErrorText(code:string):string{return errors[code]??"Não foi possível concluir a operação. Recarregue e confira se a confirmação foi registrada antes de tentar novamente.";}
