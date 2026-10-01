#!/usr/bin/env node
// C7b hardening 4c: deleting an organization (or a profile) now removes its chat rows through the FKs
// (chat_conversations.organization_id / user_id ON DELETE CASCADE, chat_messages already cascades from the conversation).
// Disposable org only; the org is deleted WITHOUT deleting any chat row first.
import { sql, provisionOrg, record, summary, cleanupOrgs } from './lib/live.mjs';

async function main() {
  const A = await provisionOrg('CC', [['u1', 'employee'], ['u2', 'employee']], 1);
  const [c1] = await sql(`insert into chat_conversations (organization_id, user_id, status) values ('${A.orgId}', '${A.users.u1.id}', 'active') returning id`);
  const [c2] = await sql(`insert into chat_conversations (organization_id, user_id, status) values ('${A.orgId}', '${A.users.u2.id}', 'resolved') returning id`);
  for (const c of [c1, c2]) await sql(`insert into chat_messages (conversation_id, role, content, slots) values ('${c.id}', 'user', 'oi', null), ('${c.id}', 'assistant', 'ola', '{"a":"b"}'::jsonb)`);
  const seeded = (await sql(`select (select count(*) from chat_conversations where organization_id='${A.orgId}') c, (select count(*) from chat_messages where conversation_id in ('${c1.id}','${c2.id}')) m`))[0];
  record('seeded 2 conversations and 4 messages', Number(seeded.c) === 2 && Number(seeded.m) === 4, seeded);

  // deleting ONE profile removes that user's conversation + messages (user_id FK cascade)
  await sql(`delete from profiles where id='${A.users.u2.id}'`);
  const afterProfile = (await sql(`select (select count(*) from chat_conversations where id='${c2.id}') c, (select count(*) from chat_messages where conversation_id='${c2.id}') m, (select count(*) from chat_conversations where id='${c1.id}') other`))[0];
  record('deleting a profile cascades to its chat conversation and messages (the other user\'s conversation stays)', Number(afterProfile.c) === 0 && Number(afterProfile.m) === 0 && Number(afterProfile.other) === 1, afterProfile);

  // deleting the ORGANIZATION (reservations first: unrelated exclusion constraint) with NO manual chat cleanup
  await sql(`delete from reservations where organization_id='${A.orgId}'`);
  await sql(`delete from organizations where id='${A.orgId}'`);
  const left = (await sql(`select (select count(*) from chat_conversations where organization_id='${A.orgId}') c, (select count(*) from chat_messages where conversation_id in ('${c1.id}','${c2.id}')) m`))[0];
  record('deleting the organization cascades to chat_conversations and chat_messages (no manual chat cleanup was done)', Number(left.c) === 0 && Number(left.m) === 0, left);
  await cleanupOrgs([A], 'chat-cascade'); // auth users + final zero check
}
main().catch((e) => record('FATAL', false, String(e))).finally(() => { process.exitCode = summary('chat-cascade-proof') ? 1 : 0; });
