import {beforeEach,describe,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement,type ReactNode} from "react";
import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import path from "node:path";
vi.mock("@/lib/i18n/getLocale",async()=>({getDictionary:async()=>(await import("@/lib/i18n/dictionaries/pt-BR")).default,getLocale:async()=>"pt-BR"}));
vi.mock("@/app/carpool/AssistantTrigger",()=>({AssistantTrigger:({children}:{children:ReactNode})=>createElement("button",null,children)}));
const state=vi.hoisted(()=>({role:"fleet_manager",failed:false,self:false}));
vi.mock("@/lib/operations/keyCustodyLoad",()=>({loadKeySession:async()=>({db:{},profile:{id:"manager",role:state.role,organization_id:"org",full_name:"Gestor de teste",organization:{name:"Ambiente de teste"}}})}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw Error(`REDIRECT:${url}`);}}));
vi.mock("@/app/carpool/FmShell",()=>({FmShell:({children}:{children:ReactNode})=>createElement("div",null,children)}));
vi.mock("@/app/fleet/carpools/actions",()=>({managePassenger:async()=>{}}));
vi.mock("./management",async original=>({...await original<typeof import("./management")>(),loadCarpoolManagement:async()=>{if(state.failed)throw Error("denied");return [{id:"offer",trip_request_id:"trip",host_id:"host",hostName:"Condutor de teste",status:"active",seats_offered:3,seats_available:2,trip:{id:"trip",origin:"São Paulo",destination:"Campinas",distance_km:90,departure_at:"2026-10-20T12:00:00Z"},reservations:[],requests:[{id:"request",rider_id:state.self?"manager":"rider",riderName:"Passageiro de teste",carpool_offer_id:"offer",status:"PENDING",requested_seats:1,created_at:"2026-10-19T12:00:00Z"}]}];}}));
import Page from "@/app/fleet/carpools/page";
async function render(){return renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));}
beforeEach(()=>{state.role="fleet_manager";state.failed=false;state.self=false;});
describe("approved composition A management page",()=>{
 it("renders master/detail, pending decisions and unavailable environmental calculations",async()=>{const html=await render();expect(html).toContain("Gestão Inteligente de Caronas");expect(html).toContain("Passageiro de teste");expect(html).toContain('value="accept"');expect(html).toContain('value="reject"');expect(html).toContain("Cálculo indisponível");const dir=process.env.FLEET_VISUAL_DIR;if(dir){mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,"carpools.html"),`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}${readFileSync(path.resolve("app/fleet/carpools/carpools.css"),"utf8")}</style>${html}</html>`);}});
 it("does not show decisions on the manager's own request",async()=>{state.self=true;const html=await render();expect(html).not.toContain('value="accept"');expect(html).toContain("outro gestor ou anfitrião");});
 it("does not show decisions or invented totals on source failure",async()=>{state.failed=true;const html=await render();expect(html).toContain("Dados indisponíveis");expect(html).not.toContain('value="accept"');});
 it("rejects employee access before loading management data",async()=>{state.role="employee";await expect(render()).rejects.toThrow("REDIRECT:/dashboard");});
});
