import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";

// Who does the vehicle check-in / check-out (migration 0250): a mobility point can say the GATE does the full checklist for the vehicles based there.
let db:PGlite;
const org=randomUUID(),driver=randomUUID(),security=randomUUID(),admin=randomUUID(),category=randomUUID();
const gatePoint=randomUUID(),officePoint=randomUUID(),gateLocation=randomUUID(),officeLocation=randomUUID();
async function actor(id:string){await db.exec("reset role");await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec("set role authenticated");}
async function reservation(location:string){
 await db.exec("reset role");const vehicle=randomUUID(),trip=randomUUID(),id=randomUUID();
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km,home_location_id) values($1,$2,$3,$4,'reserved',100,$5)",[vehicle,org,vehicle.slice(0,7),category,location]);
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour','Origem','Destino',10,1,false,'Teste')",[trip,org,driver]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',now()-interval '1 minute',now()+interval '1 hour')",[id,org,vehicle,trip]);
 return id;
}
const pickup=(id:string,role:string,damage=false)=>db.query("select record_pickup($1,150,80,null,$3,null,'{}',false,false,$2) id",[id,role,damage]);
const state=async(id:string)=>(await db.query<{s:Record<string,unknown>}>("select fm_checklist_state($1) s",[id])).rows[0]!.s;
const command=(id:string,kind:string)=>db.query("select fm_v3_command('gate.record',$1,$2)",[JSON.stringify({reservation_id:id,kind}),randomUUID()]);

beforeAll(async()=>{
 ({db}=await migratedDatabase());
 await db.query("insert into organizations(id,name) values($1,'Gate mode')",[org]);await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 for(const [id,role] of [[driver,"employee"],[security,"security"],[admin,"administrator"]]){
  await db.query("insert into auth.users(id) values($1)",[id]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa de teste',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);
 }
 for(const [id,name,by] of [[gatePoint,"Iracemapolis","gate"],[officePoint,"Escritorio","traveler"]])
  await db.query("insert into corporate_mobility_points(id,organization_id,name,address_label,latitude,longitude,checklist_by) values($1,$2,$3,'Endereco',-22,-47,$4)",[id,org,name,by]);
 await db.query("insert into vehicle_locations(id,organization_id,name,mobility_point_id) values($1,$2,'Garagem gate',$3),($4,$2,'Garagem escritorio',$5)",[gateLocation,org,gatePoint,officeLocation,officePoint]);
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Modelo',5,false,'ICE')",[category,org]);
 await actor(admin);await db.query("select fm_equipment_profile_save('category',$1,'{}','{}',true,0,'Explicit empty test model',$2)",[category,randomUUID()]);
},30000);
afterAll(async()=>db?.close());

describe.sequential("the gate does the full checklist (0250)",()=>{
 it("a new reservation takes the setting of its vehicle's mobility point; the others stay as always",async()=>{
  const gate=await reservation(gateLocation);const office=await reservation(officeLocation);
  await db.exec("reset role");
  expect((await db.query<{c:string}>("select checklist_by c from fm_reservation_operations where reservation_id=$1",[gate])).rows[0]!.c).toBe("gate");
  expect((await db.query<{c:string}>("select checklist_by c from fm_reservation_operations where reservation_id=$1",[office])).rows[0]!.c).toBe("traveler");
 });
 it("in gate mode the traveler has nothing to do and cannot fill his own checklist; the porter has the pickup",async()=>{
  const id=await reservation(gateLocation);
  await actor(driver);expect(await state(id)).toMatchObject({checklist_by:"gate",can_pickup:false,can_return:false});
  await expect(pickup(id,"traveler")).rejects.toThrow(/GATE_CHECKLIST_ONLY/);
  await actor(security);expect(await state(id)).toMatchObject({checklist_by:"gate",can_pickup:true});
 });
 it("the porter records the full checklist for the traveler plus his own, then releases the vehicle; the departure needs no second person",async()=>{
  const id=await reservation(gateLocation);
  await actor(security);await pickup(id,"traveler");await pickup(id,"security");
  await db.exec("reset role");
  const rows=(await db.query<{role:string;odo:number|null}>("select performed_by_role role, odometer_km odo from inspections where reservation_id=$1 and type='pickup' order by performed_by_role",[id])).rows;
  expect(rows).toEqual([{role:"traveler",odo:150},{role:"security",odo:null}]); // the full data (odometer 150) is the traveler-side record made on his behalf
  await actor(security);await command(id,"departure");
  await db.exec("reset role");expect((await db.query("select 1 from fm_gate_events where reservation_id=$1 and kind='departure'",[id])).rows).toHaveLength(1);
 });
 it("an office-mode reservation is untouched: the traveler fills his own and the porter cannot fill it for him",async()=>{
  const id=await reservation(officeLocation);
  await actor(security);await expect(pickup(id,"traveler")).rejects.toThrow(/INSPECTION_NOT_AUTHORIZED/);
  await actor(driver);expect(await state(id)).toMatchObject({can_pickup:true});
  await pickup(id,"traveler");
 });
 it("only an administrator changes the setting of a mobility point",async()=>{
  await actor(security);await expect(db.query("select fm_set_mobility_point_checklist_by($1,'traveler')",[gatePoint])).rejects.toThrow(/NOT_AUTHORIZED/);
  await actor(admin);await expect(db.query("select fm_set_mobility_point_checklist_by($1,'x')",[gatePoint])).rejects.toThrow(/INVALID_INPUT/);
  await db.query("select fm_set_mobility_point_checklist_by($1,'traveler')",[gatePoint]);
  const id=await reservation(gateLocation); // created after the change
  await db.exec("reset role");expect((await db.query<{c:string}>("select checklist_by c from fm_reservation_operations where reservation_id=$1",[id])).rows[0]!.c).toBe("traveler");
 });
});
