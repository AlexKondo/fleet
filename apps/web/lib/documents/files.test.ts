import {describe,it,expect} from 'vitest';
import {validateDocument,documentFilename,MAX_DOCUMENT_BYTES} from './files';
import {csvCell,dossierCsv} from './export';
describe('document bytes and portable exports',()=>{
 it('validates signature and bounded bytes instead of trusting MIME or extension',()=>{
  expect(validateDocument(Buffer.from('%PDF-1.7\ntest'),'application/pdf')).toMatch(/^[0-9a-f]{64}$/);
  expect(()=>validateDocument(Buffer.from('<svg>'), 'image/png')).toThrow(/INVALID_DOCUMENT/);
  expect(()=>validateDocument(new Uint8Array(MAX_DOCUMENT_BYTES+1),'application/pdf')).toThrow(/INVALID_DOCUMENT/);
  expect(()=>validateDocument(Buffer.from('content'),'text/html')).toThrow(/INVALID_DOCUMENT/);
 });
 it('normalizes path and header controls without changing the original object',()=>{expect(documentFilename('../nota\r\n.pdf')).toBe('.._nota__.pdf');expect(()=>documentFilename('')).toThrow();});
 it('quotes delimiters and neutralizes spreadsheet formula execution',()=>{
  expect(csvCell('  =HYPERLINK("evil")')).toBe('"\'  =HYPERLINK(""evil"")"');expect(csvCell('@command')).toBe('"\'@command"');expect(csvCell(-5)).toBe('"-5"');expect(csvCell('a;b\nc')).toBe('"a;b\nc"');
 });
 it('keeps planned, voided and warranty lines out of realized net costs',()=>{
  const csv=dossierCsv({generated_at:'2026-10-19',vehicle:{id:'v',plate:'TST',vin:null},unit:'IRA',orders:[{id:'o',number:1,description:'=formula',quote_total:100,approved_total:90}],lines:[{id:'a',work_order_id:'o',quantity:2,unit_price:10,stage:'planned'},{id:'b',work_order_id:'o',quantity:1,unit_price:25,stage:'actual',warranty:true},{id:'c',work_order_id:'o',quantity:1,unit_price:30,stage:'actual',voided_at:'today'}],documents:[],approvals:[],energy:null});
  const rows=csv.split('\r\n');expect(rows.find(r=>r.includes('"a"'))).toContain('"Orçado"');expect(rows.find(r=>r.includes('"b"'))).toContain('"25";"25";"0"');expect(rows.find(r=>r.includes('"c"'))).toContain('"Anulado"');expect(csv).toContain("'=formula");expect(csv).toContain('Energia indisponível para este perfil');
 });
 it('exports approved versus pending financial corrections without changing original lines',()=>{
  const csv=dossierCsv({vehicle:{id:'v',plate:'TEST'},orders:[{id:'o',number:1}],lines:[],approvals:[],documents:[],energy:[],adjustments:[{id:'approved',work_order_id:'o',delta:-20.01,status:'approved',reason:'Crédito conferido'},{id:'pending',work_order_id:'o',delta:50,status:'pending',reason:'Aguardando aprovação'}]});
  const approved=csv.split('\r\n').find(r=>r.includes('"approved"')),pending=csv.split('\r\n').find(r=>r.includes('"pending"'));
  expect(approved).toContain('"AJUSTE_POS_ENCERRAMENTO"');expect(approved?.split(';')[16]).toBe('"-20.01"');expect(pending?.split(';')[16]).toBe('""');
 });
});
