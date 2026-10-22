/* Local synthetic PDF/image transport smoke; no identities, AI, Auth or remote services. */
const fs=require('fs'),path=require('path'),http=require('http'),{createRequire}=require('module');
async function main(){
 const {chromium}=require('playwright'); // Fail before opening a local server if QA tooling is unavailable.
 const root=process.env.FLEET_QA_SOURCE||process.cwd(), out=process.env.FLEET_QA_OUTPUT;
 if(!out)throw Error('Set FLEET_QA_OUTPUT to a scratch directory containing synthetic fixture.pdf');
 const app=createRequire(path.join(root,'apps/web/package.json'));
 const vite=createRequire(createRequire(app.resolve('vitest/package.json')).resolve('vite/package.json'));
 const entry=path.join(out,'entry.ts');
 fs.writeFileSync(entry,`import {prepareLicenseDocument} from ${JSON.stringify(path.join(root,'apps/web/lib/domain/prepareLicenseDocument.ts'))};window.prepare=prepareLicenseDocument;`);
 await vite('esbuild').build({entryPoints:[entry],bundle:true,platform:'browser',format:'iife',outfile:path.join(out,'client.js'),logLevel:'silent'});
 const server=http.createServer((req,res)=>{
  let file;
  if(req.url==='/client.js'){file=path.join(out,'client.js');res.setHeader('Content-Type','text/javascript');}
  else if(req.url==='/fixture.pdf'){file=path.join(out,'fixture.pdf');res.setHeader('Content-Type','application/pdf');}
  else if(req.url.startsWith('/pdfjs/')||req.url.startsWith('/pdf-standard-fonts/')){
   file=path.join(root,'apps/web/public',req.url);if(req.url.endsWith('.mjs'))res.setHeader('Content-Type','text/javascript');
  }else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><script src="/client.js"></script>');return;}
  if(!fs.existsSync(file)){res.statusCode=404;res.end();return;}res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.FLEET_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(async()=>{
   const input=await(await fetch('/fixture.pdf')).blob();
   const output=await window.prepare(new File([input],'synthetic.pdf',{type:'application/pdf'}));
   const bitmap=await createImageBitmap(output);const dimensions={width:bitmap.width,height:bitmap.height};bitmap.close();
   if(output.size>3*1024*1024||dimensions.height<=2400)throw Error('Transport or all-page dimensions failed');
   const c=document.createElement('canvas');c.width=1800;c.height=2400;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='black';ctx.font='48px sans-serif';ctx.fillText('SYNTHETIC LICENSE TRANSPORT TEST',40,100);
   const blob=await new Promise(r=>c.toBlob(r,'image/png'));
   const image=new File([blob,new Uint8Array(3*1024*1024)],'synthetic.png',{type:'image/png'});
   const prepared=await window.prepare(image);
   if(prepared.size>3*1024*1024)throw Error('Image limit');
   return {pdfInput:input.size,pdfOutput:output.size,...dimensions,imageInput:image.size,imageOutput:prepared.size};
  });
  if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({status:'passed',...result,errors},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
