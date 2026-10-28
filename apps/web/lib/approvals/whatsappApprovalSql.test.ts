import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDatabase } from "../../test/migratedDatabase";

/** WhatsApp approval by the requester's direct manager, in the real migrated schema (0229). */
let db: PGlite;
const org = randomUUID(), admin = randomUUID(), requester = randomUUID(), manager = randomUUID(), other = randomUUID(), category = randomUUID();
const PHONE = "+5511987654321";

async function as(id: string | null) {
  await db.exec("reset role");
  if (id) {
    await db.query("select set_config('test.actor',$1,false)", [id]);
    await db.exec("set role authenticated");
  } else {
    // the service role has no end user: clear the identity left by the previous call
    await db.query("select set_config('test.actor','',false)");
    await db.exec("set role service_role");
  }
}
async function q<T = Record<string, unknown>>(sql: string, args: unknown[] = []) {
  return (await db.query<T>(sql, args)).rows;
}
async function reservation(opts: { vehicleStatus?: string; endsInHours?: number } = {}) {
  await db.exec("reset role");
  const vehicle = randomUUID(), trip = randomUUID(), res = randomUUID();
  await db.query("insert into vehicles(id,organization_id,plate,name,category_id,status,odometer_km) values($1,$2,$3,'Haval H6',$4,$5,100)", [vehicle, org, vehicle.slice(0, 7).toUpperCase(), category, opts.vehicleStatus ?? "available"]);
  await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()+interval '2 hours',now()+interval '8 hours','Fábrica','Cliente Campinas',90,2,false,'Visita ao cliente')", [trip, org, requester]);
  await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'pending_approval',now()+interval '2 hours',now()+make_interval(hours=>$5))", [res, org, vehicle, trip, opts.endsInHours ?? 8]);
  return { vehicle, res };
}
async function prepare(res: string, rotate = false) {
  await as(null);
  return (await q<{ r: { ok: boolean; reason?: string; token?: string; request_id?: string; payload?: Record<string, unknown> } }>("select fm_approval_prepare($1,$2) r", [res, rotate]))[0]!.r;
}
async function decide(token: string, decision: string, from = PHONE, messageId: string | null = null) {
  await as(null);
  return (await q<{ r: { status: string; reservation_id?: string } }>("select fm_approval_decide($1,$2,$3,$4) r", [token, decision, from, messageId]))[0]!.r;
}
const status = async (res: string) => { await db.exec("reset role"); return (await q<{ status: string; approved_by: string | null }>("select status, approved_by from reservations where id=$1", [res]))[0]!; };

beforeAll(async () => {
  ({ db } = await migratedDatabase());
  await db.query("insert into organizations(id,name) values($1,'Aprovação teste')", [org]);
  await db.query("insert into organization_settings(organization_id) values($1)", [org]);
  for (const [id, role, name] of [[admin, "administrator", "Admin"], [requester, "employee", "Maria Solicitante"], [manager, "employee", "Carlos Gestor"], [other, "employee", "Outra Pessoa"]]) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("insert into profiles(id,organization_id,full_name,role) values($1,$2,$3,$4)", [id, org, name, role]);
  }
  await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'SUV',5,false,'ICE')", [category, org]);
}, 30000);
afterAll(async () => db?.close());

describe.sequential("administration of the approval channel", () => {
  it("only an administrator links a manager and registers a WhatsApp number; the number is normalized and needs consent", async () => {
    await as(requester);
    await expect(db.query("select fm_set_user_manager($1,$2)", [requester, manager])).rejects.toThrow(/NOT_AUTHORIZED/);
    await expect(db.query("select fm_set_whatsapp_contact($1,$2,true)", [manager, PHONE])).rejects.toThrow(/NOT_AUTHORIZED/);
    await as(admin);
    await expect(db.query("select fm_set_user_manager($1,$1)", [requester])).rejects.toThrow(/INVALID_INPUT/);
    await expect(db.query("select fm_set_whatsapp_contact($1,'12345',true)", [manager])).rejects.toThrow(/INVALID_PHONE/);
    await expect(db.query("select fm_set_whatsapp_contact($1,$2,false)", [manager, PHONE])).rejects.toThrow(/CONSENT_REQUIRED/);
    await db.query("select fm_set_user_manager($1,$2)", [requester, manager]);
    await db.query("select fm_set_whatsapp_contact($1,'(11) 98765-4321',true)", [manager]);
    const snap = (await q<{ s: { user_id: string; manager_id: string | null; phone_e164: string | null }[] }>("select fm_approval_channel_snapshot() s"))[0]!.s;
    expect(snap.find((x) => x.user_id === requester)?.manager_id).toBe(manager);
    expect(snap.find((x) => x.user_id === manager)?.phone_e164).toBe(PHONE);
    await as(requester);
    await expect(db.query("select fm_approval_channel_snapshot()")).rejects.toThrow(/NOT_AUTHORIZED/);
    await db.exec("reset role");
    const audit = await q<{ after: { phone_suffix?: string } | null }>("select after from audit_log where action='approval.whatsapp_set'");
    expect(audit[0]!.after).toEqual({ phone_suffix: "4321" });
  });
  it("internal functions are not callable by a signed-in user", async () => {
    await as(manager);
    await expect(db.query("select fm_approval_decide('x','approve','1',null)")).rejects.toThrow();
    await expect(db.query("select fm_approval_prepare($1)", [randomUUID()])).rejects.toThrow();
    await expect(db.query("select fm_channel_approve($1,$2)", [randomUUID(), manager])).rejects.toThrow();
    await expect(db.query("select count(*) from fm_approval_requests")).rejects.toThrow();
  });
});

describe.sequential("creating the approval request", () => {
  it("builds the message data the manager needs and never stores the plain token", async () => {
    const { res } = await reservation();
    const r = await prepare(res);
    expect(r.ok).toBe(true);
    expect(r.payload).toMatchObject({ requester_name: "Maria Solicitante", vehicle_name: "Haval H6", origin: "Fábrica", destination: "Cliente Campinas", purpose: "Visita ao cliente", passengers: 2 });
    expect(r.payload!.departure_at).toBeTruthy();
    expect(r.payload!.return_at).toBeTruthy();
    await db.exec("reset role");
    const row = (await q<{ token_hash: string; phone_e164: string }>("select token_hash, phone_e164 from fm_approval_requests where id=$1", [r.request_id]))[0]!;
    expect(row.token_hash).not.toContain(r.token!);
    expect(row.token_hash).toHaveLength(64);
    expect(row.phone_e164).toBe(PHONE);
  });
  it("does nothing without a manager or without a registered number, and only one request stays pending", async () => {
    const { res } = await reservation();
    await as(admin);
    await db.query("select fm_set_user_manager($1,null)", [requester]);
    expect((await prepare(res)).reason).toBe("no_manager");
    await as(admin);
    await db.query("select fm_set_user_manager($1,$2)", [requester, other]);
    expect((await prepare(res)).reason).toBe("no_contact");
    await as(admin);
    await db.query("select fm_set_user_manager($1,$2)", [requester, manager]);
    expect((await prepare(res)).ok).toBe(true);
    expect((await prepare(res)).reason).toBe("already_pending");
    const rotated = await prepare(res, true);
    expect(rotated.ok).toBe(true);
    await db.exec("reset role");
    expect((await q<{ n: number }>("select count(*)::int n from fm_approval_requests where reservation_id=$1 and status='pending'", [res]))[0]!.n).toBe(1);
  });
  it("skips reservations that are not pending approval", async () => {
    const { res } = await reservation();
    await db.exec("reset role");
    await db.query("update reservations set status='cancelled' where id=$1", [res]);
    expect((await prepare(res)).reason).toBe("not_pending");
  });
});

describe.sequential("the manager's answer", () => {
  it("approve: confirms the reservation as the manager, reserves the vehicle, notifies and audits; a repeat of the same message is idempotent", async () => {
    const { res, vehicle } = await reservation();
    const r = await prepare(res);
    const first = await decide(r.token!, "approve", "5511987654321", "wamid.1");
    expect(first).toEqual({ status: "approved", reservation_id: res });
    expect(await status(res)).toEqual({ status: "confirmed", approved_by: manager });
    await db.exec("reset role");
    expect((await q<{ status: string }>("select status from vehicles where id=$1", [vehicle]))[0]!.status).toBe("reserved");
    expect((await q("select 1 from notifications where user_id=$1 and entity_id=$2 and title='Reserva aprovada'", [requester, res])).length).toBe(1);
    const audit = await q<{ after: { channel?: string } }>("select after from audit_log where action='reservation_approved' and entity_id=$1", [res]);
    expect(audit[0]!.after.channel).toBe("whatsapp");
    expect((await decide(r.token!, "approve", PHONE, "wamid.1")).status).toBe("approved");
    expect((await decide(r.token!, "approve", PHONE, "wamid.2")).status).toBe("already_decided");
    expect((await decide(r.token!, "reject", PHONE, "wamid.3")).status).toBe("already_decided");
    expect((await q("select 1 from notifications where entity_id=$1 and title='Reserva aprovada'", [res])).length).toBe(1);
  });
  it("reject: cancels the pending reservation and tells the requester", async () => {
    const { res, vehicle } = await reservation();
    const r = await prepare(res);
    expect((await decide(r.token!, "reject")).status).toBe("rejected");
    expect((await status(res)).status).toBe("cancelled");
    await db.exec("reset role");
    expect((await q<{ status: string }>("select status from vehicles where id=$1", [vehicle]))[0]!.status).toBe("available");
    expect((await q("select 1 from notifications where user_id=$1 and entity_id=$2 and title='Reserva recusada'", [requester, res])).length).toBe(1);
  });
  it("a wrong token, a wrong phone or an unknown decision change nothing", async () => {
    const { res } = await reservation();
    const r = await prepare(res);
    expect((await decide("0".repeat(64), "approve")).status).toBe("invalid");
    expect((await decide(r.token!, "approve", "+5511999990000")).status).toBe("phone_mismatch");
    expect((await decide(r.token!, "approve", "")).status).toBe("phone_mismatch");
    expect((await decide(r.token!, "maybe")).status).toBe("invalid");
    expect((await status(res)).status).toBe("pending_approval");
  });
  it("accepts the same Brazilian number written without the ninth digit", async () => {
    const { res } = await reservation();
    const r = await prepare(res);
    expect((await decide(r.token!, "approve", "551187654321")).status).toBe("approved");
  });
  it("an expired request cannot be used", async () => {
    const { res } = await reservation();
    const r = await prepare(res);
    await db.exec("reset role");
    await db.query("update fm_approval_requests set expires_at=now()-interval '1 minute' where id=$1", [r.request_id]);
    expect((await decide(r.token!, "approve")).status).toBe("expired");
    expect((await status(res)).status).toBe("pending_approval");
  });
  it("when the reservation was already decided in the app the WhatsApp request is superseded", async () => {
    const { res } = await reservation();
    const r = await prepare(res);
    await db.exec("reset role");
    await db.query("update reservations set status='confirmed' where id=$1", [res]);
    expect((await decide(r.token!, "approve")).status).toBe("superseded");
  });
  it("is refused when the approver is no longer the requester's manager or the account was disabled", async () => {
    const a = await reservation();
    const ra = await prepare(a.res);
    await as(admin);
    await db.query("select fm_set_user_manager($1,$2)", [requester, other]);
    expect((await decide(ra.token!, "approve")).status).toBe("not_authorized");
    expect((await status(a.res)).status).toBe("pending_approval");
    await as(admin);
    await db.query("select fm_set_user_manager($1,$2)", [requester, manager]);
    const b = await reservation();
    const rb = await prepare(b.res);
    await db.exec("reset role");
    await db.query("insert into fm_member_access(user_id,organization_id,enabled,version,reason,updated_by) values($1,$2,false,1,'Conta desativada em teste',$3)", [manager, org, admin]);
    expect((await decide(rb.token!, "approve")).status).toBe("not_authorized");
    await db.query("delete from fm_member_access where user_id=$1", [manager]);
  });
  it("does not release a vehicle that is in maintenance", async () => {
    const { res } = await reservation({ vehicleStatus: "maintenance" });
    const r = await prepare(res);
    expect((await decide(r.token!, "approve")).status).toBe("vehicle_unavailable");
    expect((await status(res)).status).toBe("pending_approval");
  });
  it("housekeeping closes requests past their expiry", async () => {
    const { res } = await reservation();
    const r = await prepare(res);
    await db.exec("reset role");
    await db.query("update fm_approval_requests set expires_at=now()-interval '1 second' where id=$1", [r.request_id]);
    await as(null);
    expect((await q<{ n: number }>("select fm_approval_expire_due() n"))[0]!.n).toBeGreaterThanOrEqual(1);
  });
});
