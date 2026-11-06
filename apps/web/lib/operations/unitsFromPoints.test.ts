import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";

// A unit is a mobility point (migration 0258): each point has its unit and each vehicle follows the point of its home location.
let db:PGlite;
const org=randomUUID(),admin=randomUUID(),driver=randomUUID(),category=randomUUID();
const point=async(name:string)=>{const id=randomUUID();await db.query("insert into corporate_mobility_points(id,organization_id,name,address_label,latitude,longitude) values($1,$2,$3,'Endereco',-22,-47)",[id,org,name]);return id;};
const location=async(pointId:string|null)=>{const id=randomUUID();await db.query("insert into vehicle_locations(id,organization_id,name,mobility_point_id) values($1,$2,$3,$4)",[id,org,id.slice(0,8),pointId]);return id;};
const vehicle=async(loc:string)=>{const id=randomUUID();await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km,home_location_id) values($1,$2,$3,$4,'available',100,$5)",[id,org,id.slice(0,7),category,loc]);return id;};
const unitOf=async(pointId:string)=>(await db.query<{id:string;name:string;enabled:boolean;workflow:string}>("select id,name,enabled,workflow from fm_units where mobility_point_id=$1",[pointId])).rows[0];
const vehicleUnit=async(id:string)=>(await db.query<{unit_id:string}>("select unit_id from fm_vehicle_units where vehicle_id=$1",[id])).rows[0]?.unit_id;
const reservation=async(vehicleId:string)=>{
 const trip=randomUUID();
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()+interval '1 hour',now()+interval '2 hours','Origem','Destino',10,1,false,'Teste')",[trip,org,driver]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',now()+interval '1 hour',now()+interval '2 hours')",[randomUUID(),org,vehicleId,trip]);
};

beforeAll(async()=>{
 ({db}=await migratedDatabase());
 await db.query("insert into organizations(id,name) values($1,'Unidades')",[org]);await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 for(const [id,role] of [[admin,"administrator"],[driver,"employee"]]){
  await db.query("insert into auth.users(id) values($1)",[id]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);
 }
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Modelo',5,false,'ICE')",[category,org]);
},60000);
afterAll(async()=>db?.close());

describe.sequential("a unit is a mobility point",()=>{
 it("a new place is a unit, on the process a vehicle without a unit already follows",async()=>{
  const p=await point("Aracruz");
  expect(await unitOf(p)).toMatchObject({name:"Aracruz",enabled:true,workflow:"gate_visual"});
 });
 it("renaming the place renames the unit",async()=>{
  const p=await point("Nome antigo");
  await db.query("update corporate_mobility_points set name='Nome novo' where id=$1",[p]);
  expect((await unitOf(p))!.name).toBe("Nome novo");
 });
 it("a unit that already had the name of the place becomes that place, instead of a second one",async()=>{
  const id=randomUUID();
  await db.query("insert into fm_units(id,organization_id,name,enabled,workflow) values($1,$2,'Campinas',true,'key_custody')",[id,org]);
  const p=await point("Campinas");
  expect(await unitOf(p)).toMatchObject({id,workflow:"key_custody"});
 });
 it("deactivating the place does not disable the unit: reservations of its vehicles keep working",async()=>{
  const p=await point("Desativado");
  await db.query("update corporate_mobility_points set is_active=false where id=$1",[p]);
  expect((await unitOf(p))!.enabled).toBe(true);
 });
 it("a new vehicle takes the unit of its home location",async()=>{
  const p=await point("Iracemapolis");
  const v=await vehicle(await location(p));
  expect(await vehicleUnit(v)).toBe((await unitOf(p))!.id);
 });
 it("a vehicle in a location with no place stays without a unit",async()=>{
  expect(await vehicleUnit(await vehicle(await location(null)))).toBeUndefined();
 });
 it("the unit picked when creating the vehicle wins over the location, and the creation does not break",async()=>{
  const fromLocation=await point("Do local"),picked=await point("Escolhida");
  const loc=await location(fromLocation);const id=randomUUID();const unit=(await unitOf(picked))!.id;
  await db.exec("begin");
  await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km,home_location_id) values($1,$2,$3,$4,'available',100,$5)",[id,org,id.slice(0,7),category,loc]);
  await db.query("insert into fm_vehicle_units(vehicle_id,organization_id,unit_id) values($1,$2,$3)",[id,org,unit]);
  await db.exec("commit");
  expect(await vehicleUnit(id)).toBe(unit);
 });
 it("changing the home location moves the vehicle to the unit of the new place",async()=>{
  const a=await point("Origem A"),b=await point("Destino B");
  const v=await vehicle(await location(a));const target=await location(b);
  await db.query("update vehicles set home_location_id=$1 where id=$2",[target,v]);
  expect(await vehicleUnit(v)).toBe((await unitOf(b))!.id);
 });
 it("linking a location to a place moves the vehicles parked there",async()=>{
  const loc=await location(null);const v=await vehicle(loc);const p=await point("Ligado depois");
  await db.query("update vehicle_locations set mobility_point_id=$1 where id=$2",[p,loc]);
  expect(await vehicleUnit(v)).toBe((await unitOf(p))!.id);
 });
 it("a vehicle with an open reservation stays in its unit, the rule of the unit.vehicle command",async()=>{
  const a=await point("Com reserva A"),b=await point("Com reserva B");
  const v=await vehicle(await location(a));await reservation(v);
  await db.query("update vehicles set home_location_id=$1 where id=$2",[await location(b),v]);
  expect(await vehicleUnit(v)).toBe((await unitOf(a))!.id);
 });
 it("deleting a place keeps the unit for history, disabled, and frees its vehicles",async()=>{
  const p=await point("Apagado");const unit=(await unitOf(p))!.id;const v=await vehicle(await location(p));
  await db.query("update vehicle_locations set mobility_point_id=null where mobility_point_id=$1",[p]);
  await db.query("delete from corporate_mobility_points where id=$1",[p]);
  const row=(await db.query<{enabled:boolean;mobility_point_id:string|null}>("select enabled,mobility_point_id from fm_units where id=$1",[unit])).rows[0]!;
  expect(row).toEqual({enabled:false,mobility_point_id:null});
  expect(await vehicleUnit(v)).toBeUndefined();
 });
 it("a reservation of a vehicle with a unit still works and keeps the place's checklist rule",async()=>{
  const p=await point("Portaria");await db.query("update corporate_mobility_points set checklist_by='gate' where id=$1",[p]);
  const v=await vehicle(await location(p));await reservation(v);
  const op=(await db.query<{workflow:string;checklist_by:string;unit_id:string}>("select o.workflow,o.checklist_by,o.unit_id from fm_reservation_operations o where o.vehicle_id=$1",[v])).rows[0]!;
  expect(op).toEqual({workflow:"gate_visual",checklist_by:"gate",unit_id:(await unitOf(p))!.id});
 });
});
