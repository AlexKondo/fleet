import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {migratedDatabase} from '../../test/migratedDatabase';
let db:PGlite;const org=randomUUID(),foreign=randomUUID(),admin=randomUUID(),manager=randomUUID(),tech=randomUUID(),employee=randomUUID(),boss=randomUUID(),category=randomUUID();let ira:string,sp:string,a:string,b:string,order:string;
async function actor(id:string){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec('set role authenticated');}
async function unit(name:string){await actor(admin);return(await db.query<{r:{id:string}}>("select fm_unit_admin_command('unit.save',$1,$2) r",[JSON.stringify({name,workflow:'gate_visual',enabled:true,version:0,reason:'Configuração de teste'}),randomUUID()])).rows[0]!.r.id;}
async function vehicle(unit:string){await db.exec('reset role');const id=randomUUID();await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'available',0)",[id,org,id.slice(0,8),category]);await actor(admin);await db.query("select fm_unit_admin_command('unit.vehicle',$1,$2)",[JSON.stringify({vehicle_id:id,unit_id:unit,version:0,reason:'Vínculo de teste'}),randomUUID()]);return id;}
type Doc={id:string;storage_path:string;state:string;version:number;sha256:string};
async function begin(kind:string,target:string,category='other',request=randomUUID(),filename='Documento.pdf'){
 return(await db.query<{r:Doc}>("select fm_document_begin($1,$2,$3,$4,'application/pdf',12,$5,$6) r",[kind,target,category,filename,'a'.repeat(64),request])).rows[0]!.r;
}
async function finish(doc:Doc){await db.query("insert into storage.objects(bucket_id,name,metadata) values('fleet-documents',$1,$2)",[doc.storage_path,JSON.stringify({size:12,mimetype:'application/pdf'})]);return db.query('select fm_document_finalize($1)',[doc.id]);}
beforeAll(async()=>{
 ({db}=await migratedDatabase());await db.query("insert into organizations(id,name) values($1,'Teste'),($2,'Externa')",[org,foreign]);
 for(const [id,role] of [[admin,'administrator'],[manager,'fleet_manager'],[tech,'maintenance_operator'],[employee,'employee'],[boss,'employee']]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query("insert into profiles(id,organization_id,full_name,role) values($1,$2,'Pessoa teste',$3)",[id,org,role]);}
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Teste',5,false,'ICE')",[category,org]);
 ira=await unit('IRA');sp=await unit('SP');a=await vehicle(ira);b=await vehicle(sp);
 await actor(admin);await db.query("select fm_manager_scope_command($1,'selected_units',$2,0,'Escopo de teste',$3)",[manager,[ira],randomUUID()]);
 await db.query("select fm_maintenance_policy_save($1,'scoped_managers','{}',$2,0,'Superior de teste',$3)",[ira,[boss],randomUUID()]);
 await actor(tech);order=(await db.query<{r:{id:string}}>("select fm_v3_command('work_order.create',$1,$2) r",[JSON.stringify({vehicle_id:a,kind:'preventive',description:'OS com documentos',quote_total:500}),randomUUID()])).rows[0]!.r.id;
 await db.query("select fm_v3_command('work_order.transition',$1,$2)",[JSON.stringify({id:order,version:1,status:'budgeted'}),randomUUID()]);
},30000);
afterAll(async()=>db?.close());
describe.sequential('immutable private operational documents and scoped export',()=>{
 it('registers intent, enforces actual storage metadata and finalizes idempotently',async()=>{
  await actor(manager);const request=randomUUID();const d=await begin('vehicle',a,'vehicle_document',request);
  expect(await begin('vehicle',a,'vehicle_document',request)).toEqual(d);
  await expect(begin('vehicle',a,'vehicle_document',request,'Outro.pdf')).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
  await expect(db.query('select fm_document_finalize($1)',[d.id])).rejects.toThrow(/DOCUMENT_UPLOAD_INCOMPLETE/);
  await finish(d);await db.query('select fm_document_finalize($1)',[d.id]);
  const docs=(await db.query<{r:{documents:Doc[]}}>("select fm_document_list('vehicle',$1) r",[a])).rows[0]!.r.documents;
  expect(docs.find(doc=>doc.id===d.id)?.state).toBe('ready');
 });
 it('enforces scope and blocks arbitrary storage paths and changes to immutable objects',async()=>{
  await actor(manager);await expect(begin('vehicle',b)).rejects.toThrow(/NOT_AUTHORIZED/);
  await expect(db.query("insert into storage.objects(bucket_id,name) values('fleet-documents',$1)",[`${org}/${randomUUID()}.pdf`])).rejects.toThrow(/row-level security/);
  const d=await begin('vehicle',a);await finish(d);
  expect((await db.query("update storage.objects set name='overwritten' where bucket_id='fleet-documents' and name=$1 returning id",[d.storage_path])).rows).toHaveLength(0);
  expect((await db.query("delete from storage.objects where bucket_id='fleet-documents' and name=$1 returning id",[d.storage_path])).rows).toHaveLength(0);
  await actor(employee);await expect(db.query('select fm_document_get($1)',[d.id])).rejects.toThrow(/NOT_AUTHORIZED/);
 });
 it('preserves files and metadata after an audited invalidation',async()=>{
  await actor(tech);const d=await begin('work_order',order,'service_report');await finish(d);
  await db.query("select fm_document_invalidate($1,2,'Arquivo anexado por engano',$2)",[d.id,randomUUID()]);
  const row=(await db.query<{r:Doc}>('select fm_document_get($1) r',[d.id])).rows[0]!.r;expect(row.state).toBe('invalidated');
  expect((await db.query("select id from storage.objects where name=$1",[d.storage_path])).rows).toHaveLength(1);
  await db.exec('reset role');await expect(db.query('delete from fm_documents where id=$1',[d.id])).rejects.toThrow(/PRESERVE_DOCUMENT_HISTORY/);
  await expect(db.query("update fm_documents set filename='Substituído.pdf',version=version+1 where id=$1",[d.id])).rejects.toThrow(/PRESERVE_DOCUMENT_HISTORY/);
 });
 it('limits the budget-only superior to quote attachments of pending authorized orders',async()=>{
  await actor(tech);const quote=await begin('work_order',order,'quote'),invoice=await begin('work_order',order,'invoice');await finish(quote);await finish(invoice);
  await actor(boss);const list=(await db.query<{r:{can_upload:boolean;documents:Doc[]}}>("select fm_document_list('work_order',$1) r",[order])).rows[0]!.r;
  expect(list.can_upload).toBe(false);expect(list.documents.some(d=>d.id===quote.id)).toBe(true);expect(list.documents.some(d=>d.id===invoice.id)).toBe(false);
  await expect(db.query('select fm_document_get($1)',[invoice.id])).rejects.toThrow(/NOT_AUTHORIZED/);
  await expect(begin('work_order',order,'quote')).rejects.toThrow(/NOT_AUTHORIZED/);
 });
 it('exports a complete vehicle history only within operational scope and omits unauthorized energy',async()=>{
  await actor(manager);await expect(db.query('select fm_vehicle_dossier($1)',[b])).rejects.toThrow(/NOT_AUTHORIZED/);
  const d=(await db.query<{r:{vehicle:{id:string};orders:{id:string}[];documents:Doc[];energy:unknown[]}}>('select fm_vehicle_dossier($1) r',[a])).rows[0]!.r;
  expect(d.vehicle.id).toBe(a);expect(d.orders.some(o=>o.id===order)).toBe(true);expect(d.documents.length).toBeGreaterThan(0);expect(d.energy).toEqual([]);
  await actor(tech);expect((await db.query<{r:{energy:unknown}}>('select fm_vehicle_dossier($1) r',[a])).rows[0]!.r.energy).toBeNull();
  await actor(boss);await expect(db.query('select fm_vehicle_dossier($1)',[a])).rejects.toThrow(/NOT_AUTHORIZED/);
 });
 it('rejects stale invalidation, control characters and a revoked manager with an open upload',async()=>{
  await actor(manager);await expect(begin('vehicle',a,'other',randomUUID(),'Nome\nindevido.pdf')).rejects.toThrow(/INVALID_INPUT/);
  const d=await begin('vehicle',a);await finish(d);await expect(db.query("select fm_document_invalidate($1,1,'Versão antiga',$2)",[d.id,randomUUID()])).rejects.toThrow(/CONCURRENT_UPDATE/);
  const pending=await begin('vehicle',a);await actor(admin);await db.query("select fm_manager_scope_command($1,'selected_units','{}',1,'Revogar acesso',$2)",[manager,randomUUID()]);
  await actor(manager);await expect(db.query('select fm_document_finalize($1)',[pending.id])).rejects.toThrow(/NOT_AUTHORIZED/);
  await expect(db.query('select fm_document_get($1)',[d.id])).rejects.toThrow(/NOT_AUTHORIZED/);
 });
});
