import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDatabase } from "../../test/migratedDatabase";

/** Reserving by WhatsApp: identity of the sender, message de-duplication and the open-session rule (migration 0230). */
let db: PGlite;
const org = randomUUID(), org2 = randomUUID(), admin = randomUUID(), ana = randomUUID(), bia = randomUUID(), cris = randomUUID(), dora = randomUUID();

async function as(id: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('test.actor',$1,false)", [id ?? ""]);
  await db.exec(id ? "set role authenticated" : "set role service_role");
}
const one = async <T,>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows[0]!;
const identify = async (phone: string | null) => (await one<{ r: { ok: boolean; reason?: string; user_id?: string; email?: string; organization_id?: string } }>("select fm_whatsapp_identify($1) r", [phone])).r;

beforeAll(async () => {
  ({ db } = await migratedDatabase());
  for (const [id, name] of [[org, "A"], [org2, "B"]]) await db.query("insert into organizations(id,name) values($1,$2)", [id, name]);
  for (const [id, o, role, name, mail] of [[admin, org, "administrator", "Admin", "admin@a.test"], [ana, org, "employee", "Ana", "ana@a.test"], [bia, org, "employee", "Bia", "bia@a.test"], [cris, org, "employee", "Cris", "cris@a.test"], [dora, org2, "employee", "Dora", "dora@b.test"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, mail]);
    await db.query("insert into profiles(id,organization_id,full_name,role) values($1,$2,$3,$4)", [id, o, name, role]);
  }
  await as(admin);
  await db.query("select fm_set_whatsapp_contact($1,'(11) 98765-4321',true)", [ana]);
  await db.query("select fm_set_whatsapp_contact($1,'(11) 91111-2222',true)", [bia]);
  await db.exec("reset role");
  // a second person registered with the SAME number (org 2): the number is ambiguous, never guessed
  await db.query("insert into fm_whatsapp_contacts(user_id,organization_id,phone_e164,consent_confirmed) values($1,$2,'+5511911112222',true)", [dora, org2]);
  // a registered number WITHOUT consent
  await db.query("insert into fm_whatsapp_contacts(user_id,organization_id,phone_e164,consent_confirmed) values($1,$2,'+5511933334444',false)", [cris, org]);
}, 30000);
afterAll(async () => db?.close());

describe.sequential("identifying the sender", () => {
  it("finds the one consented member, accepting the number with or without + / the 9th digit", async () => {
    await as(null);
    for (const p of ["5511987654321", "+55 11 98765-4321", "551187654321", "11987654321"]) {
      const r = await identify(p);
      expect(r, p).toMatchObject({ ok: true, user_id: ana, email: "ana@a.test", organization_id: org });
    }
  });
  it("never answers an unknown, unconsented, malformed or ambiguous number", async () => {
    await as(null);
    expect((await identify("5511900000000")).reason).toBe("unknown");
    expect((await identify("5511933334444")).reason).toBe("unknown"); // no consent
    expect((await identify("5511911112222")).reason).toBe("ambiguous"); // Bia (org A) and Dora (org B)
    for (const bad of [null, "", "123", "abc"]) expect((await identify(bad)).ok).toBe(false);
  });
  it("a disabled account is not recognized", async () => {
    await db.exec("reset role");
    await db.query("insert into fm_member_access(user_id,organization_id,enabled,version,reason,updated_by) values($1,$2,false,1,'Conta desativada em teste',$3)", [ana, org, admin]);
    await as(null);
    expect((await identify("5511987654321")).ok).toBe(false);
    await db.exec("reset role");
    await db.query("delete from fm_member_access where user_id=$1", [ana]);
  });
  it("only the service role can use these functions", async () => {
    await as(ana);
    await expect(db.query("select fm_whatsapp_identify('5511987654321')")).rejects.toThrow();
    await expect(db.query("select fm_whatsapp_register_inbound('m1',null,null,'text',true)")).rejects.toThrow();
    await expect(db.query("select fm_whatsapp_session_open($1,30)", [ana])).rejects.toThrow();
    await expect(db.query("select count(*) from fm_whatsapp_inbound")).rejects.toThrow();
  });
});

describe.sequential("de-duplication and sessions", () => {
  it("a message id is processed once; a repeat is refused", async () => {
    await as(null);
    const reg = async (id: string | null, handled = true) => (await one<{ b: boolean }>("select fm_whatsapp_register_inbound($1,$2,$3,'text',$4) b", [id, ana, org, handled])).b;
    expect(await reg("wamid.A")).toBe(true);
    expect(await reg("wamid.A")).toBe(false);
    expect(await reg("wamid.B", false)).toBe(true);
    expect(await reg(null)).toBe(true);
    expect(await reg("")).toBe(true);
  });
  it("a session is open only after a HANDLED message in the last minutes", async () => {
    await as(null);
    const open = async (u: string, mins = 30) => (await one<{ b: boolean }>("select fm_whatsapp_session_open($1,$2) b", [u, mins])).b;
    expect(await open(ana)).toBe(true); // wamid.A was handled
    expect(await open(bia)).toBe(false); // nothing from Bia
    await db.exec("reset role");
    await db.query("update fm_whatsapp_inbound set received_at = now() - interval '40 minutes' where message_id='wamid.A'");
    await as(null);
    expect(await open(ana)).toBe(false); // expired
    expect(await open(ana, 60)).toBe(true);
    await db.exec("reset role");
    await db.query("update fm_whatsapp_inbound set received_at = now() - interval '3 hours' where message_id='wamid.B'");
    await as(null);
    await one("select fm_whatsapp_register_inbound('wamid.C',$1,$2,'text',false)", [bia, org]);
    expect(await open(bia)).toBe(false); // ignored messages never open a session
  });
  it("old rows are pruned", async () => {
    await db.exec("reset role");
    await db.query("update fm_whatsapp_inbound set received_at = now() - interval '9 days' where message_id='wamid.B'");
    await as(null);
    await one("select fm_whatsapp_register_inbound('wamid.D',$1,$2,'text',false)", [ana, org]);
    await db.exec("reset role");
    expect((await one<{ n: number }>("select count(*)::int n from fm_whatsapp_inbound where message_id='wamid.B'")).n).toBe(0);
  });
});
