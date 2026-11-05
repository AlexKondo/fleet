import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";

// The two choices of the Política de carona (migration 0257), on the real functions: the database enforces the detour limit and writes the WhatsApp notice.
let db:PGlite;
const org=randomUUID(),host=randomUUID(),rider=randomUUID(),category=randomUUID();
const PHONE="+5511999990000";
let version=0;
async function policy(p:{over?:boolean;sees?:boolean;approval?:boolean}={}){
 version+=1;
 await db.query(`insert into carpool_policy_settings(organization_id,policy_version,host_approval_required,departure_window_minutes,return_window_minutes,max_additional_distance_km,max_additional_time_minutes,host_can_accept_over_detour,host_sees_rider_before_accept)
  values($1,$2,$3,15,15,5,10,$4,$5)`,[org,version,p.approval??true,p.over??false,p.sees??true]);
}
async function offer(){
 const vehicle=randomUUID(),trip=randomUUID(),reservation=randomUUID(),id=randomUUID();
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'reserved',100)",[vehicle,org,vehicle.slice(0,7),category]);
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()+interval '2 hours',now()+interval '5 hours','Origem','Destino',10,1,false,'Teste')",[trip,org,host]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',now()+interval '2 hours',now()+interval '5 hours')",[reservation,org,vehicle,trip]);
 await db.query("insert into carpool_offers(id,organization_id,trip_request_id,host_id,status,seats_offered,seats_available,policy_version) values($1,$2,$3,$4,'active',3,3,1)",[id,org,trip,host]);
 return id;
}
const ask=async(km:number,min:number)=>{
 const id=await offer();
 const {rows}=await db.query<{id:string}>(`select create_carpool_ride_request_as_rider($1,$2,1,null,null,now()+interval '2 hours',$3,$4,$5) id`,[rider,id,randomUUID(),km,min]);
 return rows[0]!.id;
};
const statusOf=async(id:string)=>(await db.query<{status:string}>("select status from carpool_ride_requests where id=$1",[id])).rows[0]!.status;
const notice=async(id:string)=>(await db.query<{r:Record<string,unknown>}>("select fm_carpool_notice($1) r",[id])).rows[0]!.r;

beforeAll(async()=>{
 ({db}=await migratedDatabase());
 await db.query("insert into organizations(id,name) values($1,'Carona')",[org]);await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 for(const [id,name] of [[host,"Host Motorista"],[rider,"Maria Passageira"]]){
  await db.query("insert into auth.users(id,email) values($1,$2)",[id,`${name!.split(" ")[0]}@example.invalid`]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,$3,'employee','TEST-CNH',true,current_date+30)",[id,org,name]);
 }
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Modelo',5,false,'ICE')",[category,org]);
 await db.query("insert into fm_whatsapp_contacts(user_id,organization_id,phone_e164,consent_confirmed) values($1,$2,$3,true)",[host,org,PHONE]);
},60000);
afterAll(async()=>db?.close());

describe.sequential("detour above the policy limit",()=>{
 it("off (the default): refused above the limit, as it always was",async()=>{
  await policy();
  await expect(ask(8,5)).rejects.toThrow(/CARPOOL_DETOUR_EXCEEDS_POLICY/);
  await expect(ask(3,15)).rejects.toThrow(/CARPOOL_DETOUR_EXCEEDS_POLICY/);
  expect(await statusOf(await ask(5,10))).toBe("PENDING");
 });
 it("on: reaches the host up to twice the limit, never past it",async()=>{
  await policy({over:true});
  expect(await statusOf(await ask(8,15))).toBe("PENDING");
  expect(await statusOf(await ask(10,20))).toBe("PENDING");
  await expect(ask(10.1,5)).rejects.toThrow(/CARPOOL_DETOUR_EXCEEDS_POLICY/);
  await expect(ask(3,20.1)).rejects.toThrow(/CARPOOL_DETOUR_EXCEEDS_POLICY/);
 });
 it("with automatic acceptance, a request within the limit is accepted but one above it waits for the host",async()=>{
  await policy({over:true,approval:false});
  expect(await statusOf(await ask(3,5))).toBe("ACCEPTED");
  expect(await statusOf(await ask(8,5))).toBe("PENDING");
 });
 it("the WhatsApp notice carries the detour and the limits",async()=>{
  await policy({over:true});
  const n=await notice(await ask(8,15));
  expect(n).toMatchObject({ok:true,status:"PENDING"});
  expect([Number(n.detour_km),Number(n.detour_min),Number(n.limit_km),Number(n.limit_min)]).toEqual([8,15,5,10]);
 });
});

describe.sequential("the host sees who asked",()=>{
 it("on (the default): the name goes in the notice and in the tap",async()=>{
  await policy();
  const n=await notice(await ask(1,1));
  expect(n.rider_name).toBe("Maria Passageira");
  const r=(await db.query<{r:Record<string,unknown>}>("select fm_carpool_token_resolve($1,$2) r",[n.token,PHONE])).rows[0]!.r;
  expect(r).toMatchObject({ok:true,rider_name:"Maria Passageira",rider_name_accepted:"Maria Passageira"});
 });
 it("off: no name in the notice, in the tap or while asking the reason for a refusal; the tap still knows it for after the accept",async()=>{
  await policy({sees:false});
  const id=await ask(1,1);
  const n=await notice(id);
  expect(n).toMatchObject({ok:true,status:"PENDING",rider_name:null});
  const r=(await db.query<{r:Record<string,unknown>}>("select fm_carpool_token_resolve($1,$2) r",[n.token,PHONE])).rows[0]!.r;
  expect(r).toMatchObject({ok:true,rider_name:null,rider_name_accepted:"Maria Passageira"});
  await db.query("select fm_carpool_token_mark($1,'awaiting_reason',null)",[id]);
  const p=(await db.query<{r:Record<string,unknown>}>("select fm_carpool_pending_reason($1) r",[PHONE])).rows[0]!.r;
  expect(p).toMatchObject({ok:true,request_id:id,rider_name:null});
 });
 it("off: once accepted the notice names the rider",async()=>{
  await policy({sees:false,approval:false});
  const id=await ask(1,1);
  expect(await statusOf(id)).toBe("ACCEPTED");
  expect((await notice(id)).rider_name).toBe("Maria Passageira");
 });
});
