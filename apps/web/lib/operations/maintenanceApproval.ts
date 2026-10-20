export type MaintenancePolicy={unit_id:string;mode:"scoped_managers"|"designated";approver_ids:string[];superior_ids:string[];version:number};
export function parseMaintenancePolicies(value:unknown):MaintenancePolicy[]|null{
 if(!value||typeof value!=="object"||!("policies" in value)||!Array.isArray(value.policies))return null;
 const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
 for(const p of value.policies){if(!p||typeof p!=="object"||!uuid(p.unit_id)||!["scoped_managers","designated"].includes(p.mode)||!Array.isArray(p.approver_ids)||!p.approver_ids.every(uuid)||!Array.isArray(p.superior_ids)||!p.superior_ids.every(uuid)||!Number.isSafeInteger(p.version)||p.version<1)return null;}
 return value.policies;
}
export type BudgetQueueItem={id:string;version:number;number:number;description:string;quote_total:number;approved_total:number|null;plate:string;unit:string;status:string};
export function parseBudgetQueue(value:unknown):BudgetQueueItem[]|null{
 if(!value||typeof value!=="object"||!("orders" in value)||!Array.isArray(value.orders))return null;
 for(const o of value.orders){if(!o||typeof o!=="object"||typeof o.id!=="string"||!Number.isSafeInteger(o.version)||o.version<1||!Number.isSafeInteger(o.number)||typeof o.description!=="string"||typeof o.plate!=="string"||typeof o.unit!=="string"||typeof o.quote_total!=="number"||!Number.isFinite(o.quote_total)||(o.approved_total!==null&&(typeof o.approved_total!=="number"||!Number.isFinite(o.approved_total)))||typeof o.status!=="string")return null;}
 return value.orders;
}
