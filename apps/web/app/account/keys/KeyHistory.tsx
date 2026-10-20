import type {KeyEvent} from "@/lib/operations/keyCustody";
import {Panel,date} from "@/app/operations/Workspace";
const labels={delivered:"Entrega",received:"Recebimento",exception:"Exceção"};
export function KeyHistory({events}:{events:KeyEvent[]}){
 return <Panel title="Histórico recente de custódia"><p>Últimos 100 registros nas unidades autorizadas. Alterações de acesso preservam os registros anteriores.</p>{!events.length?<p>Nenhum registro de custódia neste escopo.</p>:<div className="ow-table-scroll"><table className="ow-table ow-key-history"><thead><tr><th>Data e hora</th><th>Unidade / veículo</th><th>Ação</th><th>Responsável</th><th>Observação</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{date(e.created_at,true)}</td><td>{e.unit} · {e.plate}</td><td>{labels[e.kind]}</td><td>{e.actor}</td><td className="break-user-text">{e.reason??"—"}</td></tr>)}</tbody></table></div>}</Panel>;
}
