'use server';
import {createSupabaseServerClient} from '@/lib/supabase/server';
import {revalidatePath} from 'next/cache';
export async function restartPhoto(id:string){const db=await createSupabaseServerClient();const result=await db.rpc('fm_photo_restart',{p_id:id});revalidatePath('/account/photos');return {success:!result.error};}
