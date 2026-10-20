export const INCIDENT_STATES={open:"Aberta",analyzing:"Em análise",referred:"Encaminhada",resolved:"Resolvida",closed:"Encerrada"} as const;
export const INCIDENT_KINDS={damage:"Dano",equipment:"Equipamento",cleaning:"Limpeza",document:"Documento",mechanical:"Mecânica",other:"Outra"} as const;
export type Incident={id:string;vehicle_id:string;inspection_id:string|null;reservation_id:string|null;work_order_id:string|null;kind:keyof typeof INCIDENT_KINDS;severity:string;title:string;description:string;status:keyof typeof INCIDENT_STATES;assignee_id:string|null;resolution:string|null;version:number;created_at:string};
export type IncidentEvent={id:string;incident_id:string;status:Incident['status'];command:string;notes:string;created_at:string};
export type IncidentSnapshot={incidents:Incident[];events:IncidentEvent[];assignees:{id:string;name:string}[]};
export function parseIncidents(value:unknown):IncidentSnapshot|null{
 if(!value||typeof value!=="object")return null;const v=value as IncidentSnapshot;
 if(!Array.isArray(v.incidents)||!v.incidents.every(i=>i&&typeof i.id==="string"&&typeof i.vehicle_id==="string"&&i.status in INCIDENT_STATES&&i.kind in INCIDENT_KINDS&&typeof i.title==="string"&&typeof i.description==="string"&&Number.isSafeInteger(i.version)&&i.version>0))return null;
 if(!Array.isArray(v.events)||!v.events.every(e=>e&&typeof e.id==="string"&&typeof e.incident_id==="string"&&e.status in INCIDENT_STATES&&typeof e.notes==="string"&&typeof e.created_at==="string"))return null;
 if(!Array.isArray(v.assignees)||!v.assignees.every(a=>a&&typeof a.id==="string"&&typeof a.name==="string"))return null;
 return v;
}
export function incidentActions(status:Incident['status']){
 return status==='open'?['analyze','refer'] as const:status==='analyzing'?['refer','resolve'] as const:status==='referred'?['analyze','refer','resolve'] as const:status==='resolved'?['close','reopen'] as const:['reopen'] as const;
}
