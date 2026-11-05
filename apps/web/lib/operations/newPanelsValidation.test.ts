import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
vi.mock('@/app/operations/adjustmentActions',()=>({financialAdjustment:async()=>{}}));
import {OrderAdjustments} from '@/app/operations/OrderAdjustments';
const id='00000000-0000-4000-8000-000000000001';
describe('financial panels — source states',()=>{
 it('shows pending corrections without granting review and offers approval only when the source permits it',()=>{const adjustment={id,work_order_id:id,delta:-20.01,reason:'Crédito conferido em teste',status:'pending' as const,proposed_by:id,reviewed_by:null,review_notes:null,version:1,created_at:'2026-10-19T12:00:00Z',can_review:false};const denied=renderToStaticMarkup(createElement(OrderAdjustments,{adjustments:[adjustment],queue:true}));expect(denied).not.toContain('Aprovar ajuste');expect(denied).toContain('Pendente');const allowed=renderToStaticMarkup(createElement(OrderAdjustments,{adjustments:[{...adjustment,can_review:true}],queue:true}));expect(allowed).toContain('Aprovar ajuste');expect(allowed).toContain('Recusar ajuste');});
});
