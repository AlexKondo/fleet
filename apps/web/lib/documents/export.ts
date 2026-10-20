type Row=Record<string,unknown>;
export function csvCell(value:unknown){
 if(value===null||value===undefined)return '""';
 let text=typeof value==='object'?JSON.stringify(value):String(value);
 // Spreadsheet consumers can execute formula-like cells, even inside CSV quotes.
 if(typeof value==='string'&&/^[\s\uFEFF]*[=+\-@]/u.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
export function dossierCsv(input:unknown):string{
 if(!input||typeof input!=='object')throw new Error('INVALID_EXPORT');const d=input as Row;
 if(!d.vehicle||typeof d.vehicle!=='object'||!Array.isArray(d.orders)||!Array.isArray(d.lines)||!Array.isArray(d.approvals)||!Array.isArray(d.documents)||(d.energy!==null&&!Array.isArray(d.energy)))throw new Error('INVALID_EXPORT');
 const v=d.vehicle as Row;
 const header=['Registro','Placa','VIN','Unidade','ID','OS','Data UTC','Descrição','Estado','Etapa de custo','Orçamento solicitado BRL','Limite aprovado BRL','Quantidade','Preço unitário BRL','Valor bruto BRL','Cobertura garantia BRL','Custo efetivo GWM BRL','Unidade de energia','Referência','SHA256'];
 const rows:unknown[][]=[header,['VEICULO',v.plate,v.vin,d.unit,v.id,'',d.generated_at,v.name,v.archived_at?'Arquivado':v.status,'','','',v.odometer_km,'','','','','km','Odômetro registrado','']];
 const orderMap=new Map((d.orders as Row[]).map(o=>[String(o.id),o]));
 for(const o of d.orders as Row[])rows.push(['OS',v.plate,v.vin,d.unit,o.id,o.number,o.created_at,o.description,o.status,o.budget_pending?'Revisão pendente':'',o.quote_total,o.approved_total,'','','','','','',o.supplier,'']);
 for(const l of d.lines as Row[]){
  const quantity=Number(l.quantity),price=Number(l.unit_price);if(!Number.isFinite(quantity)||!Number.isFinite(price))throw new Error('INVALID_EXPORT');
  const cents=(BigInt(quantity.toFixed(3).replace('.',''))*BigInt(price.toFixed(2).replace('.',''))+500n)/1000n;
  const gross=Number(cents)/100;const actual=l.stage==='actual'&&!l.voided_at;
  rows.push(['ITEM_OS',v.plate,v.vin,d.unit,l.id,orderMap.get(String(l.work_order_id))?.number,l.created_at,l.description,l.voided_at?'Anulado':'Válido',l.stage==='actual'?'Executado':'Orçado','','',quantity,price,gross,actual&&l.warranty?gross:'',actual?(l.warranty?0:gross):'','',l.void_reason,'']);
 }
 for(const a of (d.adjustments??[]) as Row[]){const delta=Number(a.delta);if(!Number.isFinite(delta))throw new Error('INVALID_EXPORT');rows.push(['AJUSTE_POS_ENCERRAMENTO',v.plate,v.vin,d.unit,a.id,orderMap.get(String(a.work_order_id))?.number,a.reviewed_at??a.created_at,a.reason,a.status,'Ajuste financeiro','','',1,delta,delta,'',a.status==='approved'?delta:'','',a.review_notes,'']);}
 for(const a of d.approvals as Row[])rows.push(['APROVACAO',v.plate,v.vin,d.unit,a.id,orderMap.get(String(a.work_order_id))?.number,a.created_at,'Aprovação de orçamento','Registrada','','',a.amount,'','','','','','',a.actor_id,'']);
 for(const e of (d.energy??[]) as Row[])rows.push(['ENERGIA',v.plate,v.vin,d.unit,e.id,'',e.event_at,e.supplier,e.voided_at?'Anulado':'Válido','Executado','','',e.quantity,'',e.total_cost,'',e.voided_at?'':e.total_cost,e.kind==='charge'?'kWh':'L',e.void_reason,'']);
 if(d.energy===null)rows.push(['FONTE',v.plate,v.vin,d.unit,'','','','Energia indisponível para este perfil','Acesso não concedido']);
 for(const c of (d.equipment_contracts??[]) as Row[])rows.push(['CONTRATO_CHECKLIST',v.plate,v.vin,d.unit,c.id,'',c.created_at,`Obrigatórios: ${Array.isArray(c.required_names)?c.required_names.join(', '):''}`,c.source,'','','','','','','','','',c.reservation_id,'']);
 for(const doc of d.documents as Row[])rows.push(['DOCUMENTO',v.plate,v.vin,d.unit,doc.id,'',doc.created_at,doc.filename,doc.state,'','','','','','','','','',doc.target_id,doc.sha256]);
 return '\uFEFF'+rows.map(r=>Array.from({length:header.length},(_,i)=>csvCell(r[i])).join(';')).join('\r\n')+'\r\n';
}
