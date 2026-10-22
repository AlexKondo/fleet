import Link from 'next/link';
import {redirect} from 'next/navigation';
import {createSupabaseServerClient} from '@/lib/supabase/server';
import {getCurrentUser} from '@/lib/auth/currentUser';
import {getLocale} from '@/lib/i18n/getLocale';
import {photoRecoveryText} from '@/lib/domain/photoRecoveryText';
import {FmShell} from '@/app/carpool/FmShell';
import {PendingPhoto,type PendingItem} from './PendingPhoto';
export default async function Page(){
 const db=await createSupabaseServerClient();const user=await getCurrentUser(db);if(!user)redirect('/login');const t=photoRecoveryText(await getLocale());
 const [{data:profile},{data,error}]=await Promise.all([db.from('profiles').select('full_name,role,organization:organizations(name)').eq('id',user.id).single(),db.rpc('fm_photo_pending')]);
 if(!profile)redirect('/login');const rows=Array.isArray(data)?data as unknown as PendingItem[]:[];
 return <FmShell orgName={profile.organization?.name??'—'} userName={profile.full_name} role={profile.role} isFleetManager={['fleet_manager','administrator'].includes(profile.role)} isAdministrator={profile.role==='administrator'} active="trips" legacy wide>
 <h1 className="fm-h1">{t.title}</h1>{error?<p role="alert">{t.unavailable}</p>:rows.length?rows.map(item=><PendingPhoto key={item.id} item={item} t={t}/>):<p>{t.empty}</p>}<Link href="/account">{t.back}</Link></FmShell>;
}
