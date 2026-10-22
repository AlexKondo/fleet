/* Offline component hydration/interaction QA. No Supabase, Google, email or AI calls. */
const fs=require('fs'),path=require('path'),http=require('http');
const {createRequire}=require('module');
async function main(){
 const root=path.resolve(process.env.FLEET_QA_SOURCE||path.join(__dirname,'../..'));
 const out=path.resolve(process.env.FLEET_QA_OUTPUT||path.join(root,'docs/conclusao/evidence/browser'));
 fs.mkdirSync(out,{recursive:true});
 const deps=path.resolve(process.env.FLEET_QA_DEPENDENCIES||root);
 const appRequire=createRequire(path.join(deps,'apps/web/package.json'));
 const vitestRequire=createRequire(appRequire.resolve('vitest/package.json'));
 const viteRequire=createRequire(vitestRequire.resolve('vite/package.json'));
 const esbuild=viteRequire('esbuild');
 const {chromium}=require('playwright');
 const dict=fs.readFileSync(path.join(root,'apps/web/lib/i18n/dictionaries/pt-BR.ts'),'utf8');
 const stub=path.join(out,'actions-stub.ts');fs.writeFileSync(stub,"export async function createVehicle(){return {status:'error',error:'Mocked action'}};export async function closeDeniedDeparture(){return window.__failException?{status:'error',message:'Falha controlada — fixture'}:{status:'success',message:'Exceção registrada — fixture'}};");
 const form=path.join(root,'apps/web/app/fleet/VehicleForm.tsx');
 const exception=path.join(root,'apps/web/app/reservations/[id]/OperationExceptionForm.tsx');
 const hasException=fs.existsSync(exception);
 const shared=`import React from 'react';import {VehicleForm} from ${JSON.stringify(form)};import dict from ${JSON.stringify(path.join(root,'apps/web/lib/i18n/dictionaries/pt-BR.ts'))};${hasException?`import {OperationExceptionForm} from ${JSON.stringify(exception)};`:''}
 function Demo(){return <><VehicleForm categories={[{id:'cat1',name:'ICE model',energyType:'ICE'}]} locations={[{id:'loc1',name:'Local'}]} managementScope={{mode:'all_units',units:[]}} dict={dict}/>${hasException?`<OperationExceptionForm reservationId="11111111-1111-4111-8111-111111111111" requestId="22222222-2222-4222-8222-222222222222" locale="pt-BR"/>`:''}</>}`;
 const serverEntry=path.join(out,'server.tsx'),clientEntry=path.join(out,'client.tsx');
 fs.writeFileSync(serverEntry,shared+";import {renderToString} from 'react-dom/server';module.exports=()=>renderToString(<Demo/>);");
 fs.writeFileSync(clientEntry,shared+";import{hydrateRoot}from'react-dom/client';hydrateRoot(document.getElementById('root'),<Demo/>);");
 const plugin={name:'server-action-fixture',setup(b){b.onResolve({filter:/^(\.\/actions|\.\/exceptionAction)$/},args=>({path:stub}));}};
 const options={bundle:true,jsx:'automatic',nodePaths:[path.join(deps,'apps/web/node_modules')],plugins:[plugin],alias:{'@/lib':path.join(root,'apps/web/lib')},logLevel:'silent'};
 await esbuild.build({...options,entryPoints:[serverEntry],platform:'node',format:'cjs',outfile:path.join(out,'server.cjs')});
 await esbuild.build({...options,entryPoints:[clientEntry],platform:'browser',format:'iife',outfile:path.join(out,'client.js')});
 const html=require(path.join(out,'server.cjs'))();
 const server=http.createServer((req,res)=>{if(req.url==='/client.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(out,'client.js')));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><div id="root">'+html+'</div><script src="/client.js"></script></html>');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.FLEET_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer','--no-zygote'],headless:true});
 const results=[];
 try{for(const width of [1536,390]){
 const context=await browser.newContext({viewport:{width,height:844},timezoneId:'America/Sao_Paulo',locale:'pt-BR'});const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'?route.continue():route.abort()});
 await page.addInitScript(()=>sessionStorage.setItem('fleet.vehicle-form-draft.v1',JSON.stringify({savedAt:Date.now(),fields:{plate:'HML1234',categoryId:'cat1',name:'Draft restored',locationId:'loc1'}})));
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
 const plate=await page.locator('input[name=plate]').inputValue();const category=await page.locator('select[name=categoryId]').inputValue();
 let exceptionPassed=null;if(hasException){await page.locator('summary').filter({hasText:'Regularizar saída'}).click();const form=page.locator('form').filter({has:page.locator('input[name=reservation_id]')});await form.locator('textarea').fill('Veículo não saiu; confirmado pela portaria.');await form.locator('input[type=checkbox]').check();await page.evaluate(()=>window.__failException=true);await form.locator('button').click();await page.getByRole('alert').filter({hasText:'fixture'}).waitFor();if(await form.locator('textarea').inputValue()!=='Veículo não saiu; confirmado pela portaria.')throw new Error('Exception reason lost on failure');await page.evaluate(()=>window.__failException=false);await form.locator('input[type=checkbox]').check();await form.locator('button').click();await page.getByRole('status').filter({hasText:'fixture'}).waitFor();exceptionPassed=true;}
 results.push({viewport:width,plateRestored:plate==='HML1234',categoryRestored:category==='cat1',exceptionForm:exceptionPassed,errors});await context.close();
 }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
 const report={kind:'offline component QA; mocked actions; not authenticated application E2E',source:root,results};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(results.some(r=>r.errors.length||!r.plateRestored||!r.categoryRestored))process.exitCode=2;
}
main().catch(e=>{console.error(e);process.exitCode=1});
