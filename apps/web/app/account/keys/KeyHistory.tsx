import type {KeyEvent} from "@/lib/operations/keyCustody";
import {Panel,date} from "@/app/operations/Workspace";
import type {AccountKeysKey} from "@/lib/i18n/areas/accountKeys";
export function KeyHistory({events,T}:{events:KeyEvent[];T:Record<AccountKeysKey,string>}){
 const labels={delivered:T.kDelivered,received:T.kReceived,exception:T.kException};
 return <Panel title={T.histTitle}><p>{T.histIntro}</p>{!events.length?<p>{T.histNone}</p>:<div className="ow-table-scroll"><table className="ow-table ow-key-history"><thead><tr><th>{T.thDate}</th><th>{T.thUnit}</th><th>{T.thAction}</th><th>{T.thActor}</th><th>{T.thNote}</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{date(e.created_at,true)}</td><td>{e.unit} · {e.plate}</td><td>{labels[e.kind]}</td><td>{e.actor}</td><td className="break-user-text">{e.reason??"—"}</td></tr>)}</tbody></table></div>}</Panel>;
}
