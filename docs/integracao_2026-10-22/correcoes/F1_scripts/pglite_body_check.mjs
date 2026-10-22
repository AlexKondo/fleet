// Proves the "before" bodies dumped from the local Postgres (before_defs/*.sql) are byte-identical to what the migration
// chain 0001..<stop> produces (same harness as apps/web/test/migratedDatabase.ts). Usage:
//   node pglite_body_check.mjs [stopVersion=0214]
import {readFileSync,readdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,"../../../..");
const web=path.join(repo,"apps/web/node_modules/@electric-sql/pglite/dist");
const {PGlite}=await import(pathToFileURL(path.join(web,"index.js")).href);
const {btree_gist}=await import(pathToFileURL(path.join(web,"contrib/btree_gist.js")).href);
const stop=process.argv[2]??"0214";
const db=new PGlite({extensions:{btree_gist}});
await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
 grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 grant all on all tables in schema storage to authenticated,service_role;
 alter default privileges for role postgres in schema public grant all on tables to authenticated,anon,service_role;
 alter default privileges for role postgres in schema public grant all on sequences to authenticated,anon,service_role;`);
const dir=path.join(repo,"supabase/migrations");
for(const n of readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)).sort()){
 if(n.slice(0,4)>stop) break;
 let sql=readFileSync(path.join(dir,n),"utf8");if(n==="0001_init_schema.sql") sql=sql.replace(/^create extension if not exists pgcrypto;\r?\n/m,"");
 await db.exec(sql);
}
const sigs={fm_release_damage_hold:"uuid,text,uuid,uuid",complete_workflow_task:"uuid",cancel_workflow_task:"uuid",cancel_reservation:"uuid,text",
 fm_release_expired_reservations:"uuid,integer",fm_key_command:"uuid,text,text,uuid",record_pickup:"uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,inspection_role"};
let bad=0;
for(const [n,s] of Object.entries(sigs)){
 const got=(await db.query(`select pg_get_functiondef('public.${n}(${s})'::regprocedure) d`)).rows[0].d.replace(/\r\n/g,"\n").trimEnd();
 const want=readFileSync(path.join(here,"before_defs",n+".sql"),"utf8").replace(/\r\n/g,"\n").trimEnd();
 const same=got===want;if(!same)bad++;console.log(`${same?"IDENTICAL":"DIFFERENT"} ${n} (chain up to ${stop})`);
}
await db.close();process.exit(bad?1:0);
