import Link from "next/link";
import {FmShell} from "@/app/carpool/FmShell";
import {Panel,date} from "@/app/operations/Workspace";
import {KeyHistory} from "@/app/account/keys/KeyHistory";
import {loadKeySession} from "@/lib/operations/keyCustodyLoad";
import {parseKeyWorkspace} from "@/lib/operations/keyCustody";
import {redirect} from "next/navigation";
import {getAreaText} from "@/lib/i18n/areaText";
import {fleetKeysTexts} from "@/lib/i18n/areas/fleetKeys";
import {accountKeysTexts} from "@/lib/i18n/areas/accountKeys";
import "@/app/operations/operations.css";
export default async function KeyManagementPage(){
 const [T,TK]=await Promise.all([getAreaText(fleetKeysTexts),getAreaText(accountKeysTexts)]);
 const {db,profile}=await loadKeySession();
 if(!["fleet_manager","administrator"].includes(profile.role))redirect("/dashboard");
 const {data,error}=await db.rpc("fm_key_management_workspace");const state=error?null:parseKeyWorkspace(data);
 return <FmShell orgName={profile.organization?.name??"—"} userName={profile.full_name} role={profile.role} isFleetManager isAdministrator={profile.role==="administrator"} active="keyManagement" workspace="manager" wide><div className="ow">
 <header className="ow-heading"><div><h1>{T.title}</h1><p>{T.subtitle}</p></div>{profile.role==="administrator"&&<Link href="/admin/units">{T.configure}</Link>}</header>
 {!state?<p role="alert">{T.unavailable}</p>:<>
 <Panel title={T.panel}><p>{T.intro}</p>{!state.reservations.length?<p>{T.none}</p>:<div className="ow-table-scroll"><table className="ow-table"><thead><tr><th>{T.thUnit}</th><th>{T.thDriver}</th><th>{T.thPeriod}</th><th>{T.thKeys}</th></tr></thead><tbody>{state.reservations.map(r=><tr key={r.id}><td>{r.unit} · {r.plate}</td><td>{r.requester}</td><td><Link href={`/reservations/${r.id}`}>{date(r.start_at,true)} — {date(r.end_at,true)}</Link></td><td>{r.received?T.received:r.delivered?T.receiptPending:T.deliveryPending}{r.status==="cancelled"?T.cancelled:""}</td></tr>)}</tbody></table></div>}</Panel>
 <KeyHistory events={state.events} T={TK}/>
 </>}
 </div></FmShell>;
}
