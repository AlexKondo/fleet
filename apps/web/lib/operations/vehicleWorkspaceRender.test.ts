import {describe,it,expect,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import path from "node:path";
import dict from "@/lib/i18n/dictionaries/pt-BR";
vi.mock("@/app/carpool/AssistantTrigger",()=>({AssistantTrigger:({children}:{children:React.ReactNode})=>createElement("button",null,children)}));
import {VehicleFilterGrid} from "@/app/fleet/VehicleFilterGrid";
describe("vehicle approved list/detail composition",()=>{
 it("keeps actions tied to selected ID and renders source unavailability honestly",()=>{
  const vehicles=Array.from({length:10},(_,i)=>({id:`vehicle-${i}`,plate:`TEST${i}`,name:`Veículo de teste ${i}`,status:i===0?"maintenance":"available",categoryName:"Modelo de teste",energyType:"BEV",odometerKm:15000,nextServiceKm:i===0?14000:30000,locationName:"Local de teste",node:createElement("li",null,`Editar veículo ${i}`)}));
  const html=renderToStaticMarkup(createElement(VehicleFilterGrid,{vehicles,statusOptions:[{value:"maintenance",label:"Manutenção"},{value:"available",label:"Disponível"}],dict}));
  expect(html).toContain('aria-pressed="true"');expect((html.match(/class="vw-edit"/g)??[]).length).toBe(8);expect(html).toContain('aria-label="Editar Veículo de teste 0 (TEST0)"');expect(html).not.toContain('vw-admin');expect(html).not.toContain('Cadastro e ações administrativas');expect(html).toContain('/api/exports/vehicle/vehicle-0');expect(html).not.toContain('/api/exports/vehicle/vehicle-1');expect(html).toContain("revisão por quilometragem atingida");expect(html).toContain("Taxa de utilização e comparação histórica indisponíveis");
  const dir=process.env.FLEET_VISUAL_DIR;if(dir){mkdirSync(dir,{recursive:true});const css=["app/carpool/fm-theme.css","app/carpool/fm-shared.css","app/fm-ops.css","app/fleet/vehicle-workspace.css"].map(f=>readFileSync(path.resolve(f),"utf8")).join('\n');writeFileSync(path.join(dir,"vehicles.html"),`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:18px;font-family:Arial,sans-serif;background:#f1f7ff}*{box-sizing:border-box}${css}</style><div class="fm-theme"><div class="fm-legacy">${html}</div></div></html>`);}
 });
});
