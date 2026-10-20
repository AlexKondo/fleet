import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {migratedDatabase} from '../../test/migratedDatabase';
let db:PGlite;
const org=randomUUID(),admin=randomUUID(),manager=randomUUID(),superior=randomUUID(),tech=randomUUID(),other=randomUUID(),boss=randomUUID(),cat=randomUUID();let unit:string,vehicle:string;
async function actor(id:string){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec('set role authenticated');}
async function cmd(command:string,payload:object,request=randomUUID()){return (await db.query<{r:{id:string;version:number}}>('select fm_v3_command($1,$2,$3) r',[command,JSON.stringify(payload),request])).rows[0]!.r;}
async function policy(mode='scoped_managers',approvers:string[]=[],superiors:string[]=[superior],version=0,request=randomUUID()){
 await actor(admin);return db.query("select fm_maintenance_policy_save($1,$2,$3,$4,$5,'Política configurada em teste',$6)",[unit,mode,approvers,superiors,version,request]);
}
async function order(creator=tech){await actor(creator);const {id}=await cmd('work_order.create',{vehicle_id:vehicle,kind:'preventive',description:'Revisão de teste',quote_total:500});await cmd('work_order.transition',{id,version:1,status:'budgeted'});return id;}
beforeAll(async()=>{
 ({db}=await migratedDatabase());await db.query("insert into organizations(id,name) values($1,'Teste de aprovação')",[org]);
 for(const [id,role] of [[admin,'administrator'],[manager,'fleet_manager'],[superior,'fleet_manager'],[tech,'maintenance_operator'],[other,'fleet_manager'],[boss,'employee']]){
 await db.query('insert into auth.users(id) values($1)',[id]);await db.query("insert into profiles(id,organization_id,full_name,role) values($1,$2,'Pessoa teste',$3)",[id,org,role]);}
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Teste',5,false,'ICE')",[cat,org]);
 await actor(admin);unit=(await db.query<{r:{id:string}}>("select fm_unit_admin_command('unit.save',$1,$2) r",[JSON.stringify({name:'IRA',workflow:'gate_visual',enabled:true,version:0,reason:'Cadastro isolado'}),randomUUID()])).rows[0]!.r.id;
 vehicle=randomUUID();await db.exec('reset role');await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,'TST0001',$3,'available',0)",[vehicle,org,cat]);
 await actor(admin);await db.query("select fm_unit_admin_command('unit.vehicle',$1,$2)",[JSON.stringify({vehicle_id:vehicle,unit_id:unit,version:0,reason:'Vínculo isolado'}),randomUUID()]);
 for(const id of [manager,superior,other])await db.query("select fm_manager_scope_command($1,'selected_units',$2,0,'Autorização de teste',$3)",[id,[unit],randomUUID()]);
},30000);
afterAll(async()=>db?.close());
describe.sequential('configurable maintenance approval with actual SQL',()=>{
 it('allows the fleet manager to approve a budget submitted by maintenance and records the applied policy',async()=>{
  const id=await order();await actor(manager);await cmd('work_order.transition',{id,version:2,status:'approved'});
  const approval=(await db.query<{actor_id:string;amount:string;policy_snapshot:{mode:string}}>('select * from fm_budget_approvals where work_order_id=$1',[id])).rows[0]!;
  expect(approval.actor_id).toBe(manager);expect(Number(approval.amount)).toBe(500);expect(approval.policy_snapshot.mode).toBe('scoped_managers');
 });
 it('denies self approval for administrators and managers and requires an explicitly designated superior',async()=>{
  const id=await order(manager);await actor(manager);await expect(cmd('work_order.transition',{id,version:2,status:'approved'})).rejects.toThrow(/SELF_APPROVAL_DENIED/);
  await actor(superior);await expect(cmd('work_order.transition',{id,version:2,status:'approved'})).rejects.toThrow(/SUPERIOR_APPROVAL_REQUIRED/);
  await policy();await actor(other);await expect(cmd('work_order.transition',{id,version:2,status:'approved'})).rejects.toThrow(/SUPERIOR_APPROVAL_REQUIRED/);
  await actor(superior);await cmd('work_order.transition',{id,version:2,status:'approved'});
  const own=await order(admin);await actor(admin);await expect(cmd('work_order.transition',{id:own,version:2,status:'approved'})).rejects.toThrow(/SELF_APPROVAL_DENIED/);
 });
 it('preserves the approved limit while a revision awaits independent approval',async()=>{
  const id=await order();await actor(manager);await cmd('work_order.transition',{id,version:2,status:'approved'});
  await cmd('work_order.budget',{id,version:3,quote_total:900,reason:'Revisão necessária'});
  await db.exec('reset role');let row=(await db.query<{approved_total:string;quote_total:string;budget_pending:boolean}>('select * from fm_work_orders where id=$1',[id])).rows[0]!;
  expect(Number(row.approved_total)).toBe(500);expect(Number(row.quote_total)).toBe(900);expect(row.budget_pending).toBe(true);
  await actor(manager);await expect(cmd('work_order.approve_budget',{id,version:4})).rejects.toThrow(/SELF_APPROVAL_DENIED/);
  await actor(superior);const req=randomUUID();await cmd('work_order.approve_budget',{id,version:4},req);await cmd('work_order.approve_budget',{id,version:4},req);
  await db.exec('reset role');row=(await db.query<typeof row>('select * from fm_work_orders where id=$1',[id])).rows[0]!;expect(Number(row.approved_total)).toBe(900);expect(row.budget_pending).toBe(false);
  expect((await db.query('select id from fm_budget_approvals where work_order_id=$1',[id])).rows).toHaveLength(2);
 });
 it('applies designated approvers, enforces optimistic versions and preserves author identity after a role change',async()=>{
  await policy('designated',[manager],[superior],1);const id=await order();await actor(other);await expect(cmd('work_order.transition',{id,version:2,status:'approved'})).rejects.toThrow(/APPROVER_NOT_AUTHORIZED/);
  await actor(manager);await cmd('work_order.transition',{id,version:2,status:'approved'});
  await expect(policy('scoped_managers',[],[superior],0)).rejects.toThrow(/CONCURRENT_UPDATE/);
  const own=await order(manager);await db.exec('reset role');await db.query("update profiles set role='maintenance_operator' where id=$1",[manager]);
  await actor(other);await expect(cmd('work_order.transition',{id:own,version:2,status:'approved'})).rejects.toThrow(/SUPERIOR_APPROVAL_REQUIRED/);
  await db.exec('reset role');await db.query("update profiles set role='fleet_manager' where id=$1",[manager]);
 });
 it('tracks planned-line authors and blocks terminal completion with an unapproved revision',async()=>{
  const id=await order();await actor(manager);await cmd('work_order.transition',{id,version:2,status:'approved'});
  await cmd('work_order.transition',{id,version:3,status:'scheduled',scheduled_start:new Date(Date.now()-60000).toISOString(),scheduled_end:new Date(Date.now()+3600000).toISOString()});
  await cmd('work_order.transition',{id,version:4,status:'in_progress'});
  await cmd('work_order.line',{id,version:5,stage:'planned',category:'parts',description:'Item de orçamento',quantity:1,unit_price:600,warranty:false});
  await expect(cmd('work_order.transition',{id,version:6,status:'completed'})).rejects.toThrow(/BUDGET_APPROVAL_PENDING/);
  await expect(cmd('work_order.approve_budget',{id,version:6})).rejects.toThrow(/SELF_APPROVAL_DENIED/);
  await actor(superior);await cmd('work_order.approve_budget',{id,version:6});
  await actor(manager);await cmd('work_order.transition',{id,version:7,status:'completed'});
 });
 it('gives a designated superior budget-only authority without granting fleet management',async()=>{
  await policy('designated',[manager],[superior,boss],2);
  const id=await order(manager);await actor(boss);
  const queue=(await db.query<{q:{orders:{id:string}[]}}>('select fm_budget_approval_queue() q')).rows[0]!.q;
  expect(queue.orders.some(o=>o.id===id)).toBe(true);
  await db.query('select fm_budget_approve($1,2,$2)',[id,randomUUID()]);
  expect((await db.query('select id from fm_work_orders where id=$1',[id])).rows).toHaveLength(0);
  await expect(cmd('energy.record',{vehicle_id:vehicle})).rejects.toThrow(/NOT_AUTHORIZED/);
  await expect(cmd('work_order.transition',{id,version:3,status:'cancelled'})).rejects.toThrow(/NOT_AUTHORIZED/);
  await db.exec('reset role');expect((await db.query<{role:string}>('select role from profiles where id=$1',[boss])).rows[0]!.role).toBe('employee');
  await policy('designated',[manager],[superior],3);await actor(boss);
  await expect(db.query('select fm_budget_approve($1,3,$2)',[id,randomUUID()])).rejects.toThrow(/NOT_AUTHORIZED/);
 });
 it('rejects unauthorized policy configuration and revoked approvers without rewriting historical approvals',async()=>{
  await actor(tech);await expect(db.query("select fm_maintenance_policy_save($1,'scoped_managers','{}','{}',2,'Acesso indevido',$2)",[unit,randomUUID()])).rejects.toThrow(/NOT_AUTHORIZED/);
  await expect(policy('designated',[tech],[superior],4)).rejects.toThrow(/APPROVER_NOT_AUTHORIZED/);
  const id=await order();await actor(admin);await db.query("select fm_manager_scope_command($1,'selected_units','{}',1,'Revogação de teste',$2)",[manager,randomUUID()]);
  await actor(manager);await expect(cmd('work_order.transition',{id,version:2,status:'approved'})).rejects.toThrow(/MANAGEMENT_SCOPE_DENIED/);
  await db.exec('reset role');await expect(db.exec('delete from fm_budget_approvals')).rejects.toThrow(/PRESERVE_INSPECTION_HISTORY/);
 });
});
