import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const org = "00000000-0000-4000-8000-000000000001",
  otherOrg = "00000000-0000-4000-8000-000000000002";
const mgr = "00000000-0000-4000-8000-000000000010",
  tech = "00000000-0000-4000-8000-000000000011",
  emp = "00000000-0000-4000-8000-000000000012",
  sec = "00000000-0000-4000-8000-000000000013";
const veh = "00000000-0000-4000-8000-000000000020",
  foreign = "00000000-0000-4000-8000-000000000021",
  res = "00000000-0000-4000-8000-000000000030";
let db: PGlite;
async function actor(id = mgr) {
  await db.exec(
    `reset role;select set_config('fm.actor','${id}',false);set role authenticated`,
  );
}
async function command(
  action: string,
  payload: Record<string, unknown>,
  request = randomUUID(),
) {
  const result = await db.query<{ result: { id: string } }>(
    "select fm_v3_command($1,$2::jsonb,$3::uuid) result",
    [action, JSON.stringify(payload), request],
  );
  return result.rows[0]!.result.id;
}
async function order() {
  return command("work_order.create", {
    vehicle_id: veh,
    kind: "preventive",
    description: "Revisão programada",
    quote_total: 500,
  });
}
async function state(id: string) {
  return (
    await db.query<{ status: string; version: number }>(
      "select status,version from fm_work_orders where id=$1",
      [id],
    )
  ).rows[0]!;
}
async function transition(
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  const current = await state(id);
  return command("work_order.transition", {
    id,
    version: current.version,
    status,
    ...extra,
  });
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('fm.actor',true),'')::uuid $$;
 create type user_role as enum('employee','fleet_manager','administrator','maintenance_operator','security');
 create type vehicle_status as enum('available','reserved','awaiting_pickup','in_use','returning','inspection','charging','cleaning','maintenance','blocked');
 create type reservation_status as enum('pending_approval','confirmed','completed','cancelled');
 create type workflow_task_type as enum('repair','safety','preventive_maintenance','cleaning','fuel','charging');
 create type energy_type as enum('ICE','PHEV','BEV');
 create table organizations(id uuid primary key);insert into organizations values('${org}'),('${otherOrg}');
 create table profiles(id uuid primary key,organization_id uuid references organizations,role user_role,drivers_license_number text,drivers_license_category text,drivers_license_expiration date,driver_authorized boolean default false);insert into profiles(id,organization_id,role) values('${mgr}','${org}','fleet_manager'),('${tech}','${org}','maintenance_operator'),('${emp}','${org}','employee'),('${sec}','${org}','security');
 create function current_organization_id() returns uuid language sql stable security definer set search_path=public as $$select organization_id from profiles where id=auth.uid()$$;
 create table vehicle_categories(id uuid primary key,energy_type energy_type);insert into vehicle_categories values('${veh}','BEV');
 create table vehicles(id uuid primary key,organization_id uuid references organizations,category_id uuid references vehicle_categories,status vehicle_status default 'available',has_blocking_damage boolean default false,documentation_valid boolean default true,missing_safety_equipment text[] default '{}',updated_at timestamptz default now());insert into vehicles(id,organization_id,category_id) values('${veh}','${org}','${veh}'),('${foreign}','${otherOrg}','${veh}');
 create table reservations(id uuid primary key,organization_id uuid,vehicle_id uuid,status reservation_status,start_at timestamptz,end_at timestamptz);
 create table workflow_tasks(id uuid primary key default gen_random_uuid(),organization_id uuid,vehicle_id uuid,type workflow_task_type,notes text,status text,assigned_to uuid);
 create table inspections(id uuid primary key default gen_random_uuid(),organization_id uuid,reservation_id uuid,type text,performed_by_role text);
 create table audit_test(action text,actor_id uuid,entity_id uuid);
 create table member_notes(id uuid primary key,user_id uuid,body text);
 alter table member_notes enable row level security;
 create policy own_notes on member_notes for select to authenticated using(user_id=auth.uid());
 grant select on member_notes to authenticated;
 create function log_audit_event(uuid,uuid,text,text,uuid,jsonb default null,jsonb default null) returns void language sql as $$insert into audit_test values($3,$2,$5)$$;
 create function complete_workflow_task(uuid) returns void language sql as $$update workflow_tasks set status='done' where id=$1$$;
 grant usage on schema auth,public to authenticated;grant select on profiles,vehicles,reservations,workflow_tasks to authenticated;
 `);
  await db.exec(
    readFileSync(
      path.resolve(
        "../../supabase/migrations/0174_fleetmind_operational_workspaces.sql",
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      path.resolve("../../supabase/migrations/0175_admin_ai_and_privacy.sql"),
      "utf8",
    ),
  );
  await db.exec(readFileSync(path.resolve("../../supabase/migrations/0176_preserve_member_accounts.sql"),"utf8"));
  await actor();
}, 30000);
afterAll(async () => db?.close());
describe.sequential(
  "v3 SQL operational integrity (embedded PostgreSQL)",
  () => {
    it("rejects employee writes, cross-tenant vehicles and direct table mutations", async () => {
      await actor(emp);
      await expect(order()).rejects.toThrow(/NOT_AUTHORIZED/);
      await actor();
      await expect(
        command("work_order.create", {
          vehicle_id: foreign,
          kind: "preventive",
          description: "Revisão",
        }),
      ).rejects.toThrow(/NOT_FOUND/);
      await expect(
        db.exec(
          `insert into fm_work_orders(organization_id,vehicle_id,kind,description,created_by) values('${org}','${veh}','preventive','forjada','${mgr}')`,
        ),
      ).rejects.toThrow(/permission denied/);
    });
    it("deduplicates identical requests and rejects a reused key with different payload", async () => {
      await actor();
      const key = randomUUID();
      const payload = {
        vehicle_id: veh,
        kind: "inspection",
        description: "Inspeção auditável",
      };
      const id = await command("work_order.create", payload, key);
      expect(await command("work_order.create", payload, key)).toBe(id);
      await expect(
        command(
          "work_order.create",
          { ...payload, description: "Diferente" },
          key,
        ),
      ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
    });
    it("enforces approval role, version and valid state transitions", async () => {
      const id = await order();
      await expect(transition(id, "completed")).rejects.toThrow(
        /INVALID_STATE_TRANSITION/,
      );
      await transition(id, "budgeted");
      await actor(tech);
      await expect(transition(id, "approved")).rejects.toThrow(
        /NOT_AUTHORIZED/,
      );
      await actor();
      await transition(id, "approved");
      await expect(
        command("work_order.line", {
          id,
          version: 1,
          description: "Peça",
          category: "parts",
          quantity: 1,
          unit_price: 10,
        }),
      ).rejects.toThrow(/CONCURRENT_UPDATE/);
    });
    it("prevents conflicts in both reservation-to-maintenance directions", async () => {
      await actor();
      const id = await order();
      await transition(id, "budgeted");
      await transition(id, "approved");
      const start = "2030-01-02T12:00:00Z",
        end = "2030-01-02T14:00:00Z";
      await transition(id, "scheduled", {
        scheduled_start: start,
        scheduled_end: end,
      });
      await db.exec("reset role");
      await expect(
        db.query(
          "insert into reservations values($1,$2,$3,'confirmed',$4,$5)",
          [randomUUID(), org, veh, start, end],
        ),
      ).rejects.toThrow(/MAINTENANCE_CONFLICT/);
      await db.query(
        "insert into reservations values($1,$2,$3,'confirmed',$4,$5)",
        [
          randomUUID(),
          org,
          veh,
          "2030-02-02T12:00:00Z",
          "2030-02-02T14:00:00Z",
        ],
      );
      await actor();
      await expect(
        transition(id, "scheduled", {
          scheduled_start: "2030-02-02T12:30:00Z",
          scheduled_end: "2030-02-02T14:30:00Z",
        }),
      ).rejects.toThrow(/RESERVATION_CONFLICT/);
      await transition(id, "cancelled");
    });
    it("keeps financial records append-only and checks motorizations", async () => {
      await actor();
      await expect(
        command("energy.record", {
          vehicle_id: veh,
          kind: "fuel",
          quantity: 10,
          fuel_type: "gasoline",
          total_cost: 50,
          odometer_km: 1,
          event_at: "2025-01-01T12:00:00Z",
        }),
      ).rejects.toThrow(/POWERTRAIN_MISMATCH/);
      const id = await command("energy.record", {
        vehicle_id: veh,
        kind: "charge",
        quantity: 30,
        total_cost: 40,
        odometer_km: 1,
        event_at: "2025-01-01T12:00:00Z",
      });
      await expect(
        db.query("delete from fm_energy_events where id=$1", [id]),
      ).rejects.toThrow(/permission denied/);
      await command("energy.void", { id, reason: "Correção documental" });
      const rows = await db.query<{ voided_at: string }>(
        "select voided_at from fm_energy_events where id=$1",
        [id],
      );
      expect(rows.rows[0]?.voided_at).toBeTruthy();
    });
    it("never records a blocked departure, but accepts a real arrival with legacy reason", async () => {
      await db.exec("reset role");
      await db.query(
        "insert into reservations values($1,$2,$3,'confirmed',now()-interval '1 hour',now()+interval '1 hour')",
        [res, org, veh],
      );
      await db.exec(`update vehicles set status='blocked' where id='${veh}'`);
      await actor(sec);
      await expect(
        command("gate.record", { reservation_id: res, kind: "departure" }),
      ).rejects.toThrow(/DEPARTURE_BLOCKED/);
      await command("gate.record", {
        reservation_id: res,
        kind: "denied",
        reason: "Veículo bloqueado",
      });
      await expect(
        command("gate.record", { reservation_id: res, kind: "arrival" }),
      ).rejects.toThrow(/LEGACY_ARRIVAL_REASON_REQUIRED/);
      await command("gate.record", {
        reservation_id: res,
        kind: "arrival",
        reason: "Viagem anterior à implantação",
      });
      await expect(
        command("gate.record", {
          reservation_id: res,
          kind: "arrival",
          reason: "Repetida",
        }),
      ).rejects.toThrow(/duplicate key/);
    });
    it("requires budget revision before completing an overrun and preserves warranty costs", async () => {
      await db.exec("reset role");
      await db.exec(
        `update vehicles set status='available' where id='${veh}'; update reservations set status='completed' where id='${res}'`,
      );
      await actor();
      const id = await order();
      await transition(id, "budgeted");
      await transition(id, "approved");
      await transition(id, "scheduled", {
        scheduled_start: new Date(Date.now() - 3600000).toISOString(),
        scheduled_end: new Date(Date.now() + 3600000).toISOString(),
      });
      await transition(id, "in_progress");
      await command("work_order.line", {
        id,
        version: (await state(id)).version,
        description: "Serviço executado",
        stage: "actual",
        category: "labor",
        quantity: 1,
        unit_price: 600,
        warranty: false,
      });
      await command("work_order.line", {
        id,
        version: (await state(id)).version,
        description: "Peça em garantia",
        stage: "actual",
        category: "parts",
        quantity: 1,
        unit_price: 900,
        warranty: true,
      });
      await expect(transition(id, "completed")).rejects.toThrow(
        /APPROVED_BUDGET_EXCEEDED/,
      );
      await actor(tech);
      await expect(
        command("work_order.budget", {
          id,
          version: (await state(id)).version,
          quote_total: 650,
          reason: "Revisão necessária",
        }),
      ).rejects.toThrow(/NOT_AUTHORIZED/);
      await actor();
      await command("work_order.budget", {
        id,
        version: (await state(id)).version,
        quote_total: 650,
        reason: "Complemento aprovado",
      });
      await transition(id, "completed");
      expect((await state(id)).status).toBe("completed");
      await expect(
        command("work_order.line", {
          id,
          version: (await state(id)).version,
          description: "Alteração indevida",
          category: "parts",
          quantity: 1,
          unit_price: 5,
        }),
      ).rejects.toThrow(/INVALID_STATE_TRANSITION/);
    });
    it("rejects NaN costs even through a direct RPC", async () => {
      await actor();
      await expect(
        command("work_order.create", {
          vehicle_id: veh,
          kind: "preventive",
          description: "Custo inválido",
          quote_total: "NaN",
        }),
      ).rejects.toThrow(/fm_quote_finite/);
    });
    it("does not disclose maintenance costs through the gate snapshot", async () => {
      await actor(sec);
      const rows = await db.query<{ data: Record<string, unknown> }>(
        "select fm_v3_snapshot() data",
      );
      expect(rows.rows[0]!.data).toHaveProperty("gate");
      expect(rows.rows[0]!.data).not.toHaveProperty("orders");
      expect(rows.rows[0]!.data).not.toHaveProperty("energy");
      await actor(emp);
      await expect(db.exec("select fm_v3_snapshot()")).rejects.toThrow(
        /NOT_AUTHORIZED/,
      );
    });
    it("keeps the technical identity immutable and writes the audit with session actor", async () => {
      await actor();
      await command("vehicle.identity", {
        vehicle_id: veh,
        vin: "LGWABC12345678901",
        next_service_date: "2030-01-01",
      });
      await expect(
        command("vehicle.identity", {
          vehicle_id: veh,
          vin: "LGWABC12345678902",
        }),
      ).rejects.toThrow(/IMMUTABLE_VIN/);
      await db.exec("reset role");
      const rows = await db.query<{ actor_id: string }>(
        "select actor_id from audit_test where action='vehicle.identity'",
      );
      expect(rows.rows[0]!.actor_id).toBe(mgr);
    });
  },
);

describe.sequential("v3 administrative SQL integrity", () => {
  it("versions governance, rejects non-admin changes and isolates privacy requests", async () => {
    const admin = "00000000-0000-4000-8000-000000000099";
    await db.exec("reset role");
    await db.exec(
      `insert into profiles(id,organization_id,role) values('${admin}','${org}','administrator')`,
    );
    await actor(emp);
    const request = randomUUID();
    await db.query("select fm_privacy_submit($1,$2,$3)", [
      "access",
      "Quero consultar meus dados",
      request,
    ]);
    await expect(db.query("select fm_admin_snapshot()")).rejects.toThrow(
      /NOT_AUTHORIZED/,
    );
    await actor(admin);
    const key = randomUUID();
    const policy = { version: 0, enabled: false, reason: "Política de teste" };
    await db.query("select fm_admin_command($1,$2,$3)", [
      "ai.policy",
      JSON.stringify(policy),
      key,
    ]);
    const disabled = await db.query<{
      p: { enabled: boolean; version: number };
    }>("select fm_ai_policy_read() p");
    expect(disabled.rows[0]!.p).toMatchObject({ enabled: false, version: 1 });
    await expect(
      db.query("select fm_admin_command($1,$2,$3)", [
        "ai.policy",
        JSON.stringify({ ...policy, enabled: true }),
        randomUUID(),
      ]),
    ).rejects.toThrow(/CONCURRENT_UPDATE/);
    await db.query("select fm_admin_command($1,$2,$3)", [
      "privacy.respond",
      JSON.stringify({
        id: request,
        version: 1,
        status: "in_review",
        response: "Solicitação recebida para análise",
      }),
      randomUUID(),
    ]);
    await actor(emp);
    const mine = await db.query<{ r: { id: string; response: string }[] }>(
      "select fm_my_privacy_requests() r",
    );
    expect(mine.rows[0]!.r[0]!.id).toBe(request);
    expect(mine.rows[0]!.r[0]!.response).toContain("análise");
    await actor(sec);
    expect(
      (await db.query<{ r: unknown[] }>("select fm_my_privacy_requests() r"))
        .rows[0]!.r,
    ).toEqual([]);
  });
});

describe.sequential("member deactivation preserves history",()=>{
  const admin="00000000-0000-4000-8000-000000000099";
  const spare="00000000-0000-4000-8000-000000000098";
  async function access(user:string,enabled:boolean,version:number,key=randomUUID()) {
    return db.query<{result:{version:number}}>("select fm_member_access_command($1,$2,$3,$4,$5) result",[user,enabled,version,"Alteração administrativa de teste",key]);
  }
  it("deactivates without deleting a profile or its records, blocks JWT access and reactivates",async()=>{
    await db.exec("reset role");
    await db.query("insert into member_notes values($1,$2,'historical message')",[randomUUID(),emp]);
    await actor(emp);
    expect((await db.query("select * from member_notes")).rows).toHaveLength(1);
    await expect(access(mgr,false,0)).rejects.toThrow(/NOT_AUTHORIZED/);
    await actor(admin);
    const key=randomUUID();
    await access(emp,false,0,key);
    await access(emp,false,0,key);
    await expect(access(emp,true,0,key)).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
    await actor(emp);
    expect((await db.query<{enabled:boolean}>("select fm_account_enabled() enabled")).rows[0]!.enabled).toBe(false);
    expect((await db.query("select * from member_notes")).rows).toHaveLength(0);
    expect((await db.query("select * from get_my_license()")).rows).toHaveLength(0);
    expect((await db.query<{org:string|null}>("select current_organization_id() org")).rows[0]!.org).toBeNull();
    await expect(command("work_order.create",{vehicle_id:veh,kind:"preventive",description:"test"})).rejects.toThrow(/NOT_AUTHORIZED/);
    await actor(admin);
    await expect(access(emp,true,0)).rejects.toThrow(/CONCURRENT_UPDATE/);
    await access(emp,true,1);
    await actor(emp);
    expect((await db.query("select * from member_notes")).rows).toHaveLength(1);
    await db.exec("reset role");
    expect((await db.query("select id from profiles where id=$1",[emp])).rows).toHaveLength(1);
    expect((await db.query("select * from fm_member_access_history where user_id=$1",[emp])).rows).toHaveLength(2);
  });
  it("prevents self-deactivation and another organization's target",async()=>{
    await actor(admin);
    await expect(access(admin,false,0)).rejects.toThrow(/CANNOT_DEACTIVATE_SELF/);
    await db.exec("reset role");
    await db.query("insert into profiles(id,organization_id,role) values($1,$2,'employee')",[randomUUID(),otherOrg]);
    const target=(await db.query<{id:string}>("select id from profiles where organization_id=$1",[otherOrg])).rows[0]!.id;
    await actor(admin);
    await expect(access(target,false,0)).rejects.toThrow(/NOT_FOUND/);
    await expect(db.exec("update fm_member_access set enabled=true")).rejects.toThrow(/permission denied/);
  });
  it("counts active admins across role changes and deactivation",async()=>{
    await db.exec("reset role");
    await db.query("insert into profiles(id,organization_id,role) values($1,$2,'administrator')",[spare,org]);
    await actor(admin);
    await access(spare,false,0);
    await db.exec("reset role;set role service_role");
    await expect(db.query("select update_member_role($1,$2,'employee')",[org,admin])).rejects.toThrow(/would be left with none/);
    // An inactive former administrator does not prevent a valid role change.
    await db.query("select update_member_role($1,$2,'employee')",[org,spare]);
    await actor(admin);
    await access(spare,true,1);
  });
  it("rejects hard deletion of identities and truncation even by the table owner",async()=>{
    await db.exec("reset role");
    await expect(db.query("delete from profiles where id=$1",[emp])).rejects.toThrow(/PRESERVE_USER_HISTORY/);
    await db.query("insert into auth.users values($1)",[emp]);
    await expect(db.query("delete from auth.users where id=$1",[emp])).rejects.toThrow(/PRESERVE_USER_HISTORY/);
    await expect(db.exec("truncate auth.users")).rejects.toThrow(/PRESERVE_USER_HISTORY/);
  });
  it("does not undo recorded access decisions through rollback",async()=>{
    await db.exec("reset role");
    await expect(db.exec(readFileSync(path.resolve("../../supabase/migrations/rollback/0176_preserve_member_accounts.sql"),"utf8"))).rejects.toThrow(/ACCESS_HISTORY_EXISTS/);
    expect((await db.query("select * from fm_member_access_history")).rows.length).toBeGreaterThan(0);
  });

});
