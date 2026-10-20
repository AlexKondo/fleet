import {expect,it} from "vitest";
import {migratedDatabase} from "../../test/migratedDatabase";
it("applies the actual migration chain to a disposable platform scaffold",async()=>{
 const {db,migrations}=await migratedDatabase();
 try{
  expect(migrations).toContain("0176_preserve_member_accounts.sql");
  expect((await db.query("select to_regprocedure('fm_member_access_command(uuid,boolean,integer,text,uuid)') fn")).rows[0]).toBeTruthy();
 }finally{await db.close();}
},30000);
