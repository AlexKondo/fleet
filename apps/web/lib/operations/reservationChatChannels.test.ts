import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";

let db:PGlite;
const org=randomUUID(),category=randomUUID(),vehicle=randomUUID(),trip=randomUUID(),reservation=randomUUID();
const requester=randomUUID(),manager=randomUUID(),admin=randomUUID(),porter=randomUUID(),stranger=randomUUID();

async function actor(id:string){await db.exec("reset role");await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec("set role authenticated");}
async function post(id:string,body:string,channel?:string){
 await actor(id);
 if(channel)await db.query("select post_reservation_message($1,'text',$2,null,$3)",[reservation,body,channel]);
 else await db.query("select post_reservation_message($1,'text',$2)",[reservation,body]);
}
async function reads(id:string){await actor(id);return (await db.query<{body:string}>("select body from reservation_messages where reservation_id=$1",[reservation])).rows.map(r=>r.body);}
async function notified(body:string){await db.exec("reset role");return (await db.query<{user_id:string}>("select user_id from notifications where body=$1 order by user_id",[`CHT1A11: ${body}`])).rows.map(r=>r.user_id).sort();}
async function channelOf(body:string){await db.exec("reset role");return (await db.query<{channel:string}>("select channel from reservation_messages where body=$1",[body])).rows[0]?.channel;}

beforeAll(async()=>{
 ({db}=await migratedDatabase());
 await db.query("insert into organizations(id,name) values($1,'Organização do chat')",[org]);
 await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 for(const [id,role] of [[requester,"employee"],[manager,"fleet_manager"],[admin,"administrator"],[porter,"security"],[stranger,"employee"]] as const){
  await db.query("insert into auth.users(id) values($1)",[id]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa de teste',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);
 }
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Categoria de teste',5,false,'ICE')",[category,org]);
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,'CHT1A11',$3,'reserved',100)",[vehicle,org,category]);
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()+interval '1 hour',now()+interval '2 hours','Origem','Destino',10,1,false,'Teste')",[trip,org,requester]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',now()+interval '1 hour',now()+interval '2 hours')",[reservation,org,vehicle,trip]);
 // a new fleet manager has no implicit scope
 await actor(admin);await db.query("select fm_manager_scope_command($1,'all_units',$2,0,'Autorização administrativa de teste',$3)",[manager,[],randomUUID()]);await db.exec("reset role");
},60000);
afterAll(async()=>db?.close());

describe.sequential("reservation chat: private conversations (migration 0255)",()=>{
 it("the porter talks to the fleet manager: the managers are told and read it, the requester neither",async()=>{
  await post(porter,"portaria para gestor","manager_security");
  expect(await notified("portaria para gestor")).toEqual([manager,admin].sort());
  expect(await reads(manager)).toContain("portaria para gestor");
  expect(await reads(admin)).toContain("portaria para gestor");
  expect(await reads(porter)).toContain("portaria para gestor");
  expect(await reads(requester)).not.toContain("portaria para gestor");
 });
 it("the porter talks to the requester: only the requester is told, the managers do not read it",async()=>{
  await post(porter,"portaria para solicitante","requester_security");
  expect(await notified("portaria para solicitante")).toEqual([requester]);
  expect(await reads(requester)).toContain("portaria para solicitante");
  expect(await reads(manager)).not.toContain("portaria para solicitante");
 });
 it("the requester answers the gate: every porter is told",async()=>{
  await post(requester,"solicitante para portaria","requester_security");
  expect(await notified("solicitante para portaria")).toEqual([porter]);
 });
 it("a manager answers the gate; the sender is never told about their own message",async()=>{
  await post(manager,"gestor para portaria","manager_security");
  expect(await notified("gestor para portaria")).toEqual([porter]);
  await post(porter,"portaria de novo","manager_security");
  expect(await notified("portaria de novo")).not.toContain(porter);
 });
 it("without a channel (the assistant, the app still in production) nothing changes for the requester and the managers",async()=>{
  await post(requester,"pelo assistente");
  expect(await channelOf("pelo assistente")).toBe("requester_manager");
  expect(await notified("pelo assistente")).toEqual([manager,admin].sort());
  expect(await reads(porter)).not.toContain("pelo assistente");
  await post(manager,"resposta do gestor");
  expect(await channelOf("resposta do gestor")).toBe("requester_manager");
  expect(await notified("resposta do gestor")).toEqual([requester]);
 });
 it("without a channel the gate still reaches the requester",async()=>{
  await post(porter,"portaria sem canal");
  expect(await channelOf("portaria sem canal")).toBe("requester_security");
  expect(await notified("portaria sem canal")).toEqual([requester]);
 });
 it("nobody writes in a conversation that is not theirs",async()=>{
  await expect(post(requester,"intruso","manager_security")).rejects.toThrow(/CHANNEL_NOT_ALLOWED/);
  await expect(post(porter,"intruso","requester_manager")).rejects.toThrow(/CHANNEL_NOT_ALLOWED/);
  await expect(post(manager,"intruso","requester_security")).rejects.toThrow(/CHANNEL_NOT_ALLOWED/);
  await expect(post(manager,"intruso","qualquer_coisa")).rejects.toThrow(/CHANNEL_NOT_ALLOWED/);
  await expect(post(stranger,"intruso")).rejects.toThrow(/Not authorized/);
  expect(await reads(stranger)).toEqual([]);
 });
 it("the delay effect is untouched and there is one function only",async()=>{
  await db.exec("reset role");
  const fns=await db.query<{n:number}>("select count(*)::int n from pg_proc where proname='post_reservation_message'");
  expect(fns.rows[0]!.n).toBe(1);
  await actor(requester);
  const out=await db.query<{r:{message_id:string;impacted_reservation_ids:string[]}}>("select post_reservation_message($1,'delay','atraso',now()+interval '5 hours') r",[reservation]);
  expect(out.rows[0]!.r.impacted_reservation_ids).toEqual([]);
  expect(await channelOf("atraso")).toBe("requester_manager");
 });
 it("opening a conversation records the reading of that person, and clears only that conversation's bell notices",async()=>{
  await post(requester,"para a portaria ler","requester_security");
  await post(manager,"gestor para a portaria ler","manager_security");
  const unread=async(body:string)=>{await db.exec("reset role");return (await db.query<{n:number}>("select count(*)::int n from notifications where user_id=$1 and body=$2 and read_at is null",[porter,`CHT1A11: ${body}`])).rows[0]!.n;};
  expect(await unread("para a portaria ler")).toBe(1);
  await actor(porter);
  await db.query("select fm_mark_chat_read($1,'requester_security')",[reservation]);
  expect(await unread("para a portaria ler")).toBe(0);
  expect(await unread("gestor para a portaria ler")).toBe(1);
  await actor(porter);
  const mine=await db.query<{channel:string}>("select channel from reservation_chat_reads where reservation_id=$1",[reservation]);
  expect(mine.rows.map(r=>r.channel)).toEqual(["requester_security"]);
  await db.query("select fm_mark_chat_read($1,'requester_security')",[reservation]);
  expect((await db.query("select 1 from reservation_chat_reads where reservation_id=$1",[reservation])).rows).toHaveLength(1);
 });
 it("each person only sees their own reading, and nobody marks a conversation that is not theirs",async()=>{
  await actor(requester);
  expect((await db.query("select 1 from reservation_chat_reads where reservation_id=$1",[reservation])).rows).toHaveLength(0);
  await expect(db.query("select fm_mark_chat_read($1,'manager_security')",[reservation])).rejects.toThrow(/CHANNEL_NOT_ALLOWED/);
  await actor(stranger);
  await expect(db.query("select fm_mark_chat_read($1,'requester_manager')",[reservation])).rejects.toThrow(/CHANNEL_NOT_ALLOWED/);
  await actor(porter);
  await expect(db.query("insert into reservation_chat_reads(organization_id,reservation_id,channel,user_id) values($1,$2,'requester_security',$3)",[org,reservation,porter])).rejects.toThrow(/permission denied/);
 });
 it("every message is tied to the vehicle of the reservation, and keeps it after a vehicle swap",async()=>{
  await post(requester,"sobre este carro","requester_manager");
  await db.exec("reset role");
  const vehicleOf=async(body:string)=>(await db.query<{vehicle_id:string}>("select vehicle_id from reservation_messages where body=$1",[body])).rows[0]?.vehicle_id;
  expect(await vehicleOf("sobre este carro")).toBe(vehicle);
  const other=randomUUID();
  await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,'CHT2B22',$3,'reserved',100)",[other,org,category]);
  await db.query("update reservations set vehicle_id=$2 where id=$1",[reservation,other]);
  expect(await vehicleOf("sobre este carro")).toBe(vehicle);
  await post(requester,"sobre o carro novo","requester_manager");
  await db.exec("reset role");
  expect(await vehicleOf("sobre o carro novo")).toBe(other);
  expect((await db.query<{n:number}>("select count(*)::int n from notifications where body=$1",["CHT2B22: sobre o carro novo"])).rows[0]!.n).toBeGreaterThan(0);
  await db.query("update reservations set vehicle_id=$2 where id=$1",[reservation,vehicle]);
 });
});
