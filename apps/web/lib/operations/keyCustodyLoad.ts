import "server-only";
import {redirect} from "next/navigation";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {getCurrentUser} from "@/lib/auth/currentUser";
export async function loadKeySession(admin=false){
 const db=await createSupabaseServerClient();const user=await getCurrentUser(db);
 if(!user)redirect("/login");
 const {data:profile,error}=await db.from("profiles").select("id,full_name,role,organization_id,organization:organizations(name)").eq("id",user.id).single();
 if(error||!profile)redirect("/dashboard");
 if(admin&&profile.role!=="administrator")redirect("/dashboard");
 return {db,profile};
}
