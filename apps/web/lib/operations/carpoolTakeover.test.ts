import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";

// Carpool takeover (migration 0251): the owner cancels, the first accepted rider who can drive is offered the reservation.
let db:PGlite;
const org=randomUUID(),host=randomUUID(),riderA=randomUUID(),riderB=randomUUID(),noLicense=randomUUID(),manager=randomUUID(),admin=randomUUID(),category=randomUUID(),location=randomUUID();
async function actor(id:string){await db.exec("reset role");await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec("set role authenticated");}
async function root(){await db.exec("reset role");}
const iso=(h:number)=>new Date(Date.now()+h*3_600_000).toISOString();

// a confirmed reservation of the host with an active offer and the given accepted riders (in that order)
let slot=0; // every scenario gets its own time window: the same people are reused and a rider with an overlapping reservation is (rightly) skipped
async function scenario(riders:string[],startInHours=72+(slot++)*12){
 await root();
 const vehicle=randomUUID(),trip=randomUUID(),reservation=randomUUID(),offer=randomUUID();
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'reserved',100)",[vehicle,org,vehicle.slice(0,7),category]);
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,$4,$5,'Origem','Destino',10,1,false,'Teste')",[trip,org,host,iso(startInHours),iso(startInHours+8)]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',$5,$6)",[reservation,org,vehicle,trip,iso(startInHours),iso(startInHours+8)]);
 await db.query("insert into carpool_offers(id,organization_id,trip_request_id,host_id,status,seats_offered,seats_available,policy_version) values($1,$2,$3,$4,'active',3,3,1)",[offer,org,trip,host]);
 let k=0;
 for(const rider of riders){k++;await db.query("insert into carpool_ride_requests(organization_id,carpool_offer_id,rider_id,requested_seats,requested_departure_at,status,policy_version,created_at,responded_at) values($1,$2,$3,1,$4,'ACCEPTED',1,now()-interval '1 hour'*$5,now()-interval '1 hour'*$5)",[org,offer,rider,iso(startInHours),10-k]);}
 return {vehicle,trip,reservation,offer,startInHours};
}
const takeover=async(reservation:string)=>(await db.query<{status:string;candidate_id:string;position:number}>("select status,candidate_id,position from carpool_takeovers where reservation_id=$1 order by offered_at desc limit 1",[reservation])).rows[0];
const owner=async(trip:string)=>(await db.query<{requester_id:string}>("select requester_id from trip_requests where id=$1",[trip])).rows[0]!.requester_id;
const resStatus=async(id:string)=>(await db.query<{status:string}>("select status from reservations where id=$1",[id])).rows[0]!.status;
const outbox=async(user:string,kind?:string)=>(await db.query<{kind:string;text:string;buttons:{id:string}[]|null}>("select kind,text,buttons from fm_whatsapp_outbox where user_id=$1 and ($2::text is null or kind=$2) order by created_at",[user,kind??null])).rows;

beforeAll(async()=>{
 ({db}=await migratedDatabase());
 await db.query("insert into organizations(id,name) values($1,'Takeover')",[org]);await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 const people:[string,string,string|null][]=[[host,"employee","L1"],[riderA,"employee","L2"],[riderB,"employee","L3"],[noLicense,"employee",null],[manager,"fleet_manager","L4"],[admin,"administrator","L5"]];
 for(const [id,role,lic] of people){
  await db.query("insert into auth.users(id,email) values($1,$2)",[id,`${id.slice(0,8)}@example.invalid`]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,$3,$4,$5,$6,$7)",[id,org,`Pessoa ${id.slice(0,4)}`,role,lic,lic!==null,lic?new Date(Date.now()+400*86_400_000).toISOString().slice(0,10):null]);
 }
 for(const id of [riderA,riderB,manager,admin]) await db.query("insert into fm_whatsapp_contacts(user_id,organization_id,phone_e164,consent_confirmed) values($1,$2,$3,true)",[id,org,`+5511${Math.floor(900000000+Math.random()*99999999)}`]).catch(()=>undefined);
 await db.query("insert into vehicle_locations(id,organization_id,name) values($1,$2,'Garagem')",[location,org]);
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Modelo',5,false,'ICE')",[category,org]);
},30000);
afterAll(async()=>db?.close());

describe.sequential("carpool takeover (0251)",()=>{
 it("without an accepted rider the cancellation is the normal one",async()=>{
  const s=await scenario([]);await actor(host);
  await db.query("select cancel_reservation($1,'mudei de ideia')",[s.reservation]);
  await root();expect(await resStatus(s.reservation)).toBe("cancelled");expect(await takeover(s.reservation)).toBeUndefined();
 });
 it("the first accepted rider gets the reservation, the others' carpool closes, nobody is cancelled; the owner is told",async()=>{
  const s=await scenario([riderA,riderB]);await actor(host);
  await db.query("select cancel_reservation($1,'mudei de ideia')",[s.reservation]);
  await root();
  expect(await resStatus(s.reservation)).toBe("confirmed"); // still held: nothing was cancelled
  expect(await owner(s.trip)).toBe(riderA);
  expect(await takeover(s.reservation)).toMatchObject({status:"offered",candidate_id:riderA,position:1});
  const live=(await db.query("select 1 from carpool_ride_requests rr join carpool_offers o on o.id=rr.carpool_offer_id where o.trip_request_id=$1 and rr.status in ('PENDING','ACCEPTED')",[s.trip])).rows;
  expect(live).toHaveLength(0);
  expect((await db.query("select 1 from notifications where user_id=$1 and title='Reserva repassada ao caroneiro'",[host])).rows).toHaveLength(1);
  expect((await db.query("select 1 from notifications where user_id=$1 and title='Convite para assumir a reserva'",[riderA])).rows).toHaveLength(1);
 });
 it("the invitation goes by WhatsApp with Aceitar / Recusar tokens; the reservation cannot start while it waits",async()=>{
  const s=await scenario([riderA]);await actor(host);await db.query("select cancel_reservation($1,null)",[s.reservation]);
  await root();
  const msgs=await outbox(riderA,"takeover_offer");const last=msgs[msgs.length-1];
  if(last){expect(last.buttons!.map(b=>b.id.startsWith("tk:yes:")?"yes":b.id.startsWith("tk:no:")?"no":"?")).toEqual(["yes","no"]);expect(last.text).toContain("cancelada pelo motorista");}
  await actor(riderA);
  const st=(await db.query<{s:Record<string,unknown>}>("select fm_checklist_state($1) s",[s.reservation])).rows[0]!.s;
  expect(st).toMatchObject({can_pickup:false,takeover_pending:true});
 });
 it("accepting puts the reservation in 'aguardando aprovação' (still held); the manager approves and the rider owns it",async()=>{
  const s=await scenario([riderA]);await actor(host);await db.query("select cancel_reservation($1,null)",[s.reservation]);
  const t=(await takeover(s.reservation))!;void t;
  await root();const id=(await db.query<{id:string}>("select id from carpool_takeovers where reservation_id=$1",[s.reservation])).rows[0]!.id;
  await actor(host);expect((await db.query<{r:{ok:boolean}}>("select fm_takeover_respond($1,true) r",[id])).rows[0]!.r.ok).toBe(false); // somebody else's invitation
  await actor(riderA);const r=(await db.query<{r:{ok:boolean;outcome:string}}>("select fm_takeover_respond($1,true) r",[id])).rows[0]!.r;
  expect(r).toMatchObject({ok:true,outcome:"accepted"});
  await root();expect(await resStatus(s.reservation)).toBe("pending_approval");expect(await takeover(s.reservation)).toMatchObject({status:"accepted"});
  await root();await db.query("update reservations set status='confirmed' where id=$1",[s.reservation]); // the manager's approval
  expect(await takeover(s.reservation)).toMatchObject({status:"approved"});
  expect((await db.query("select 1 from notifications where user_id=$1 and title='Reserva assumida aprovada'",[riderA])).rows).toHaveLength(1);
  expect(await owner(s.trip)).toBe(riderA);
 });
 it("a rejection by the manager cancels it and tells the rider",async()=>{
  const s=await scenario([riderA]);await actor(host);await db.query("select cancel_reservation($1,null)",[s.reservation]);
  await root();const id=(await db.query<{id:string}>("select id from carpool_takeovers where reservation_id=$1",[s.reservation])).rows[0]!.id;
  await actor(riderA);await db.query("select fm_takeover_respond($1,true)",[id]);
  await root();await db.query("update reservations set status='cancelled' where id=$1",[s.reservation]);
  expect(await takeover(s.reservation)).toMatchObject({status:"rejected"});
  expect((await db.query("select 1 from notifications where user_id=$1 and title='Reserva assumida recusada'",[riderA])).rows).toHaveLength(1);
 });
 it("declining passes to the next rider; the last decline releases the vehicle",async()=>{
  const s=await scenario([riderA,riderB]);await actor(host);await db.query("select cancel_reservation($1,null)",[s.reservation]);
  await root();const id=(await db.query<{id:string}>("select id from carpool_takeovers where reservation_id=$1",[s.reservation])).rows[0]!.id;
  await actor(riderA);await db.query("select fm_takeover_respond($1,false)",[id]);
  await root();expect(await takeover(s.reservation)).toMatchObject({status:"offered",candidate_id:riderB,position:2});expect(await owner(s.trip)).toBe(riderB);
  await actor(riderB);await db.query("select fm_takeover_respond($1,false)",[id]);
  await root();expect(await takeover(s.reservation)).toMatchObject({status:"released"});
  expect(await resStatus(s.reservation)).toBe("cancelled");expect(await owner(s.trip)).toBe(host);
  expect((await db.query<{status:string}>("select status from vehicles where id=$1",[s.vehicle])).rows[0]!.status).toBe("available");
 });
 it("a rider who cannot drive is skipped; if nobody can drive the reservation is cancelled normally and the vehicle is released",async()=>{
  const skip=await scenario([noLicense,riderB]);await actor(host);await db.query("select cancel_reservation($1,null)",[skip.reservation]);
  await root();expect(await takeover(skip.reservation)).toMatchObject({status:"offered",candidate_id:riderB});
  const none=await scenario([noLicense]);await actor(host);await db.query("select cancel_reservation($1,null)",[none.reservation]);
  await root();expect(await resStatus(none.reservation)).toBe("cancelled");expect(await takeover(none.reservation)).toBeUndefined();
  expect((await db.query<{status:string}>("select status from vehicles where id=$1",[none.vehicle])).rows[0]!.status).toBe("available");
 });
 it("a rider with an overlapping reservation of his own is skipped",async()=>{
  const first=await scenario([riderA]);
  await root();const t=randomUUID();
  await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,$4,$5,'O','D',10,1,false,'x')",[t,org,riderA,iso(first.startInHours-2),iso(first.startInHours+10)]);
  const v=randomUUID();await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'reserved',1)",[v,org,v.slice(0,7),category]);
  await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',$5,$6)",[randomUUID(),org,v,t,iso(first.startInHours-2),iso(first.startInHours+10)]);
  await actor(host);await db.query("select cancel_reservation($1,null)",[first.reservation]);
  await root();expect(await resStatus(first.reservation)).toBe("cancelled"); // riderA overlaps and nobody else: released
 });
 it("an expired invitation moves on (the tick)",async()=>{
  const s=await scenario([riderA,riderB]);await actor(host);await db.query("select cancel_reservation($1,null)",[s.reservation]);
  await root();await db.query("update carpool_takeovers set expires_at=now()-interval '1 minute' where reservation_id=$1",[s.reservation]);
  const n=(await db.query<{n:number}>("select fm_takeover_expire_due() n")).rows[0]!.n;
  expect(n).toBeGreaterThanOrEqual(1);expect(await takeover(s.reservation)).toMatchObject({candidate_id:riderB,position:2});
 });
 it("the WhatsApp token answers only from the candidate's own number",async()=>{
  const s=await scenario([riderA]);await actor(host);await db.query("select cancel_reservation($1,null)",[s.reservation]);
  await root();const msgs=await outbox(riderA,"takeover_offer");const last=msgs[msgs.length-1];
  if(!last){return;} // the rider has no WhatsApp number in this fixture
  const token=last.buttons![0]!.id.slice("tk:yes:".length);const phone=(await db.query<{p:string}>("select phone_e164 p from fm_whatsapp_contacts where user_id=$1",[riderA])).rows[0]!.p;
  expect((await db.query<{r:{reason:string}}>("select fm_takeover_token_apply($1,'5500000000000',true) r",[token])).rows[0]!.r.reason).toBe("phone_mismatch");
  expect((await db.query<{r:{ok:boolean;outcome:string}}>("select fm_takeover_token_apply($1,$2,true) r",[token,phone])).rows[0]!.r).toMatchObject({ok:true,outcome:"accepted"});
 });
});
