import {PGlite} from "@electric-sql/pglite";
import {btree_gist} from "@electric-sql/pglite/contrib/btree_gist";
import {readFileSync,readdirSync} from "node:fs";
import path from "node:path";

/** Disposable only: actual application SQL, simulated Supabase platform schemas.
 * pgcrypto installation is omitted: this runtime has built-in gen_random_uuid
 * but no pgcrypto bundle. Storage files/Auth HTTP APIs are not simulated. */
export async function migratedDatabase(options?:{beforeMigration?:(db:PGlite,name:string)=>Promise<void>}) {
 const db=new PGlite({extensions:{btree_gist}});
 try {
  await db.exec(`
   create role authenticated;create role anon;create role service_role bypassrls;
   create schema auth;create schema storage;
   create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb);
   alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
   grant usage on schema public,auth,storage to authenticated,anon,service_role;
   grant execute on function auth.uid() to authenticated,anon,service_role;
   grant all on all tables in schema storage to authenticated,service_role;
   alter default privileges for role postgres in schema public grant all on tables to authenticated,anon,service_role;
   alter default privileges for role postgres in schema public grant all on sequences to authenticated,anon,service_role;
  `);
  const directory=path.resolve("../../supabase/migrations");
  const names=readdirSync(directory).filter(n=>/^\d+_.+\.sql$/.test(n)).sort();
  for(const name of names){
   await options?.beforeMigration?.(db,name);
   let sql=readFileSync(path.join(directory,name),"utf8");
   if(name==="0001_init_schema.sql") sql=sql.replace(/^create extension if not exists pgcrypto;\r?\n/m,"");
   try{await db.exec(sql);}catch(error){throw new Error(`Migration ${name}: ${error instanceof Error?error.message:String(error)}`);}
  }
  return {db,migrations:names};
 }catch(error){await db.close();throw error;}
}
