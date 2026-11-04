import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";

// The database guarantee behind the site / chat refusal: one person never holds two live reservations in the same period (migration 0244).
let db:PGlite;
const org=randomUUID(),person=randomUUID(),other=randomUUID(),category=randomUUID(),carA=randomUUID(),carB=randomUUID();
const hour=3_600_000,at=(h:number)=>new Date(Date.UTC(2031,0,1,0)+h*hour).toISOString();
async function trip(requester:string){const id=randomUUID();await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now(),now()+interval '1 hour','Origem','Destino',10,1,false,'Teste')",[id,org,requester]);return id;}
async function reserve(vehicle:string,requester:string,from:number,to:number,status="confirmed"){return db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),org,vehicle,await trip(requester),status,at(from),at(to)]);}

beforeAll(async()=>{
 ({db}=await migratedDatabase({enforceOnePersonRule:true}));
 await db.query("insert into organizations(id,name) values($1,'Uma pessoa por periodo')",[org]);await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 for(const id of [person,other]){await db.query("insert into auth.users(id) values($1)",[id]);await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa teste','employee','TEST-CNH',true,current_date+30)",[id,org]);}
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Cat',5,false,'ICE')",[category,org]);
 for(const [id,plate] of [[carA,"AAA0A00"],[carB,"BBB0B00"]])await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'available',100)",[id,org,plate,category]);
},30000);
afterAll(async()=>db?.close());

describe.sequential("one vehicle per person per period (database)",()=>{
 it("refuses a second live reservation of the same person that overlaps the first, on another vehicle",async()=>{
  await reserve(carA,person,10,14);
  await expect(reserve(carB,person,12,16)).rejects.toThrow(/USER_RESERVATION_OVERLAP/);
  await expect(reserve(carB,person,11,13,"pending_approval")).rejects.toThrow(/USER_RESERVATION_OVERLAP/);
 });
 it("allows back-to-back periods, another person at the same time, and a new reservation once the first is cancelled",async()=>{
  await reserve(carB,person,14,18);
  await reserve(carB,other,10,14);
  await db.query("update reservations set status='cancelled' where start_at=$1 and end_at=$2 and trip_request_id in (select id from trip_requests where requester_id=$3)",[at(10),at(14),person]);
  await reserve(carA,person,11,13);
 });
});
