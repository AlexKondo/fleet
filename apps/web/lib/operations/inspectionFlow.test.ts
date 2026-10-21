import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";
let db:PGlite;
const org=randomUUID(),driver=randomUUID(),security=randomUUID(),other=randomUUID(),manager=randomUUID(),location=randomUUID(),category=randomUUID();
async function actor(id:string){await db.exec("reset role");await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec("set role authenticated");}
async function fixture(status="confirmed"){
 await db.exec("reset role");
 const vehicle=randomUUID(),trip=randomUUID(),reservation=randomUUID();
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'reserved',100)",[vehicle,org,vehicle.slice(0,7),category]);
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour','Origem','Destino',10,1,false,'Teste operacional')",[trip,org,driver]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,$5,now()-interval '1 minute',now()+interval '1 hour')",[reservation,org,vehicle,trip,status]);
 return {vehicle,reservation};
}
async function pickup(id:string,role="traveler",damage=false){return (await db.query<{id:string}>("select record_pickup($1,100,80,null,$3,null,'{}',false,false,$2) id",[id,role,damage])).rows[0]!.id;}
async function returned(id:string,role="traveler",damage=false){return (await db.query<{id:string}>("select record_return($1,120,70,null,$3,null,'{}',false,false,$2,'COMPLETE_RETURN_INSPECTION_CLEAN','{}',$4) id",[id,role,damage,location])).rows[0]!.id;}
beforeAll(async()=>{
 ({db}=await migratedDatabase());
 await db.query("insert into organizations(id,name) values($1,'Teste isolado')",[org]);
 await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 for(const [id,role] of [[driver,"employee"],[security,"security"],[other,"employee"],[manager,"administrator"]]){
  await db.query("insert into auth.users(id) values($1)",[id]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa de teste',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);
 }
 await db.query("insert into vehicle_locations(id,organization_id,name) values($1,$2,'Ponto de teste')",[location,org]);
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Modelo de teste',5,false,'ICE')",[category,org]);
 await actor(manager);
 await db.query("select fm_equipment_profile_save('category',$1,'{}','{}',true,0,'Explicit empty test model',$2)",[category,randomUUID()]);
},30000);
afterAll(async()=>db?.close());
describe.sequential("verified inspection flow with actual migrated SQL",()=>{
 it("allows distinct traveler and security pickup in either order and deduplicates retries",async()=>{
  for(const first of ["traveler","security"]){
   const {reservation}=await fixture();
   await actor(first==="traveler"?driver:security);const id=await pickup(reservation,first);
   expect(await pickup(reservation,first)).toBe(id);
   await actor(first==="traveler"?security:driver);await pickup(reservation,first==="traveler"?"security":"traveler");
   await db.exec("reset role");
   expect((await db.query("select id from inspections where reservation_id=$1",[reservation])).rows).toHaveLength(2);
   const visual=(await db.query<{observation_kind:string;odometer_km:number|null;fuel_level_percent:number|null;missing_safety_equipment:string[]|null}>("select observation_kind,odometer_km,fuel_level_percent,missing_safety_equipment from inspections where reservation_id=$1 and performed_by_role='security'",[reservation])).rows[0]!;
   expect(visual).toEqual({observation_kind:"gate_visual",odometer_km:null,fuel_level_percent:null,missing_safety_equipment:null});
  }
 });
 it("rejects forged roles, another traveler, cancelled/pending/completed reservations and direct inserts",async()=>{
  let {reservation}=await fixture();await actor(driver);
  await expect(pickup(reservation,"security")).rejects.toThrow(/INSPECTION_NOT_AUTHORIZED/);
  await actor(other);await expect(pickup(reservation)).rejects.toThrow(/INSPECTION_NOT_AUTHORIZED/);
  // D1-05 (0198): a scoped manager/administrator may record the DRIVER checklist on his behalf (see package01Fixes.test.ts),
  // but never the gate visual check.
  await actor(manager);await expect(pickup(reservation,"security")).rejects.toThrow(/INSPECTION_NOT_AUTHORIZED/);
  for(const status of ["cancelled","pending_approval","completed"]){({reservation}=await fixture(status));await actor(driver);await expect(pickup(reservation)).rejects.toThrow(/RESERVATION_NOT_CONFIRMED/);}
  await expect(db.exec("insert into inspections default values")).rejects.toThrow(/permission denied/);
 });
 it("holds a return until both independent observations and derives damage tasks on the server",async()=>{
  const {reservation,vehicle}=await fixture();await actor(driver);await pickup(reservation);await actor(security);await pickup(reservation,"security");
  await db.exec("reset role");expect((await db.query<{status:string}>("select status from vehicles where id=$1",[vehicle])).rows[0]!.status).toBe("awaiting_pickup");
  await actor(security);await expect(db.query("select fm_v3_command('gate.record',$1,$2)",[JSON.stringify({reservation_id:reservation,kind:"arrival",reason:"Tentativa fora de ordem"}),randomUUID()])).rejects.toThrow(/PHYSICAL_DEPARTURE_REQUIRED/);
  await actor(driver);await expect(returned(reservation)).rejects.toThrow(/VEHICLE_NOT_ON_TRIP|PHYSICAL_DEPARTURE_REQUIRED/);
  await actor(security);await db.query("select fm_v3_command('gate.record',$1,$2)",[JSON.stringify({reservation_id:reservation,kind:"departure"}),randomUUID()]);
  await actor(driver);await expect(returned(reservation)).rejects.toThrow(/PHYSICAL_ARRIVAL_REQUIRED/);
  await actor(security);await db.query("select fm_v3_command('gate.record',$1,$2)",[JSON.stringify({reservation_id:reservation,kind:"arrival"}),randomUUID()]);
  await actor(driver);const id=await returned(reservation,"traveler",true);expect(await returned(reservation,"traveler",true)).toBe(id);
  await db.exec("reset role");
  expect((await db.query<{status:string}>("select status from reservations where id=$1",[reservation])).rows[0]!.status).toBe("confirmed");
  await actor(security);await returned(reservation,"security",false);
  expect((await db.query<{claim:boolean}>("select fm_claim_return_notice($1) claim",[reservation])).rows[0]!.claim).toBe(true);
  expect((await db.query<{claim:boolean}>("select fm_claim_return_notice($1) claim",[reservation])).rows[0]!.claim).toBe(false);
  await db.exec("reset role");
  expect((await db.query<{status:string}>("select status from reservations where id=$1",[reservation])).rows[0]!.status).toBe("completed");
  expect((await db.query<{status:string}>("select status from vehicles where id=$1",[vehicle])).rows[0]!.status).toBe("maintenance");
  expect((await db.query("select id from workflow_tasks where vehicle_id=$1 and type='repair'",[vehicle])).rows).toHaveLength(1);
  await actor(security);await returned(reservation,"security",false);
  await db.exec("reset role");expect((await db.query("select id from workflow_tasks where vehicle_id=$1 and type='repair'",[vehicle])).rows).toHaveLength(1);
 });
 it("preserves observations, rejects cross-actor photos and cannot alter existing evidence",async()=>{
  const {reservation}=await fixture();await actor(driver);const inspection=await pickup(reservation);
  await actor(other);
  await expect(db.query("insert into inspection_photos(organization_id,inspection_id,angle,storage_path) values($1,$2,'damage',$3)",[org,inspection,`${org}/${inspection}/damage.jpg`])).rejects.toThrow(/row-level security/);
  await db.exec("reset role");
  await expect(db.query("update inspections set damage_notes='changed' where id=$1",[inspection])).rejects.toThrow(/PRESERVE_INSPECTION_HISTORY/);
 });
 it("requires a real stored object owned by the inspector and prevents bystander reads",async()=>{
  const {reservation}=await fixture();await actor(driver);const inspection=await pickup(reservation);
  const name=`${org}/${inspection}/damage_${randomUUID()}.jpg`;
  const photo=()=>db.query("insert into inspection_photos(organization_id,inspection_id,angle,storage_path) values($1,$2,'damage',$3)",[org,inspection,name]);
  await expect(photo()).rejects.toThrow(/row-level security/);
  await db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[name]);await photo();
  expect((await db.query("select id from inspection_photos where inspection_id=$1",[inspection])).rows).toHaveLength(1);
  await actor(other);expect((await db.query("select id from storage.objects where name=$1",[name])).rows).toHaveLength(0);
  expect((await db.query("select id from inspection_photos where inspection_id=$1",[inspection])).rows).toHaveLength(0);
 });
 it("does not disclose another person's checklist state through batch endpoints",async()=>{
  const {reservation}=await fixture();await actor(other);
  expect((await db.query<{state:object}>("select fm_my_checklist_states($1) state",[[reservation]])).rows[0]!.state).toEqual({});
  await expect(db.query("select fm_gate_checklist_states($1)",[[reservation]])).rejects.toThrow(/INSPECTION_NOT_AUTHORIZED/);
  await actor(driver);expect(Object.keys((await db.query<{state:object}>("select fm_my_checklist_states($1) state",[[reservation]])).rows[0]!.state)).toEqual([reservation]);
 });
 it("rechecks current driver authorization at physical departure",async()=>{
  const {reservation}=await fixture();await actor(driver);await pickup(reservation);await actor(security);await pickup(reservation,"security");
  await db.exec("reset role");await db.query("update profiles set driver_authorized=false where id=$1",[driver]);
  try{
   await actor(security);await expect(db.query("select fm_v3_command('gate.record',$1,$2)",[JSON.stringify({reservation_id:reservation,kind:"departure"}),randomUUID()])).rejects.toThrow(/DRIVER_NOT_AUTHORIZED/);
  }finally{await db.exec("reset role");await db.query("update profiles set driver_authorized=true where id=$1",[driver]);}
 });
 it("records arrival and independent returns for a blocked vehicle without releasing its block",async()=>{
  const {reservation,vehicle}=await fixture();await actor(driver);await pickup(reservation);await actor(security);await pickup(reservation,"security");
  await db.query("select fm_v3_command('gate.record',$1,$2)",[JSON.stringify({reservation_id:reservation,kind:"departure"}),randomUUID()]);
  // Simulate a block already present in the fleet; the manual block RPC intentionally refuses an active trip.
  await db.exec("reset role");await db.query("update vehicles set status='blocked',pre_block_status='in_use' where id=$1",[vehicle]);
  await actor(security);await db.query("select fm_v3_command('gate.record',$1,$2)",[JSON.stringify({reservation_id:reservation,kind:"arrival"}),randomUUID()]);
  await returned(reservation,"security");await actor(driver);await returned(reservation);
  await db.exec("reset role");expect((await db.query<{status:string}>("select status from vehicles where id=$1",[vehicle])).rows[0]!.status).toBe("blocked");
 });
 it("does not record a plug-in charge for a self-charging HEV",async()=>{
  const {vehicle}=await fixture();const hev=randomUUID();
  await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'HEV de teste',5,false,'HEV')",[hev,org]);
  await db.query("update vehicles set category_id=$1 where id=$2",[hev,vehicle]);
  await actor(manager);await expect(db.query("select fm_v3_command('energy.record',$1,$2)",[JSON.stringify({vehicle_id:vehicle,kind:"charge",quantity:1,total_cost:1,odometer_km:100,event_at:new Date().toISOString()}),randomUUID()])).rejects.toThrow(/POWERTRAIN_MISMATCH/);
 });
});
