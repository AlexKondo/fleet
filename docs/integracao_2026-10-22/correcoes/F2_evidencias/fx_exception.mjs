// LOCAL fixture tagged 'F2' (same recipe as S3 t2_fixture): SP gate_visual reservation on GWM2H62, requester mariana,
// traveler + security pickup checklist recorded, departure denied at the gate. Prints the reservation id.
import { sql, sqlClaims, users } from './common.mjs';
const ORG = '00000000-0000-0000-0000-000000000001';
const n = process.argv[2] ?? '1';
const tr = `f2000000-0000-0000-0000-0000000000a${n}`, res = `f2000000-0000-0000-0000-0000000000b${n}`;
const veh = sql(`select id from vehicles where plate='GWM2H62'`);
if (sql(`select count(*) from reservations where id='${res}'`) === '0') {
  sql(`insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,justification,allow_carpool)
     values('${tr}','${ORG}','${users.mariana.id}', now()+interval '20 minutes', now()+interval '5 hours','Matriz Faria Lima','Centro Técnico Campinas',95,1,'F2 fixture saída impedida',false);
     insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at,approved_by,approved_at)
     values('${res}','${ORG}','${veh}','${tr}','confirmed', now()+interval '20 minutes', now()+interval '5 hours','${users.admin.id}',now());`);
  sqlClaims(users.mariana.id, `insert into inspections(organization_id,reservation_id,vehicle_id,type,performed_by,performed_by_role,odometer_km,fuel_level_percent,missing_safety_equipment,is_dirty_exterior,is_dirty_interior) values('${ORG}','${res}','${veh}','pickup','${users.mariana.id}','traveler',20000,70,'{}',false,false) returning id`);
  sqlClaims(users.security.id, `insert into inspections(organization_id,reservation_id,vehicle_id,type,performed_by,performed_by_role) values('${ORG}','${res}','${veh}','pickup','${users.security.id}','security') returning id`);
  sqlClaims(users.security.id, `insert into fm_gate_events(organization_id,reservation_id,vehicle_id,kind,reason,created_by) values('${ORG}','${res}','${veh}','denied','F2: saída negada na portaria (teste local)','${users.security.id}') returning id`);
}
console.log(sql(`select r.id||' '||r.status||' '||v.plate||' '||v.status from reservations r join vehicles v on v.id=r.vehicle_id where r.id='${res}'`));
