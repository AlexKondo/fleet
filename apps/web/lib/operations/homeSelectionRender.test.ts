import {describe,expect,it,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("next/link",()=>({default:({children,href}:{children:React.ReactNode;href:string})=>createElement("a",{href},children)}));
import {HomeDetailPanel,HomeGantt,HomeSelectionProvider} from "@/app/dashboard/HomeSelection";
import {fleetTexts} from "@/lib/i18n/areas/fleet";

const labels={departure:"Saída",ret:"Devolução",placeholder:"Toque numa linha ou numa barra",viewDetails:"Ver detalhes",pickup:"Saída do veículo",returnAction:"Registrar devolução",location:"Local",battery:"Bateria",fuel:"Combustível",odometer:"Odômetro"};
const now=Date.parse("2026-11-04T15:00:00Z");
const Provider=HomeSelectionProvider as React.ComponentType<Record<string,unknown>>;
const wrap=(...kids:React.ReactNode[])=>createElement(Provider,{items:[item],labels},...kids);
const item={id:"r1",statusLabel:"Aprovada",tone:"ok",startLabel:"04/11 08:00",endLabel:"04/11 20:00",origin:"Iracemápolis",destination:"São Paulo Office",vehicleName:"Ora 05",plate:"CCD0710",location:"Carregador",battery:100,fuel:null,odometer:"9.000 km",canPickup:true,canReturn:false};

describe("employee home: tap a chart row or bar to see the reservation details",()=>{
 it("the side panel asks for a tap until something is selected; the small-screen panel does not take space yet",()=>{
  const html=renderToStaticMarkup(wrap(createElement(HomeDetailPanel,{key:"d",variant:"desktop"}),createElement(HomeDetailPanel,{key:"m",variant:"mobile"})));
  expect(html).toContain("Toque numa linha ou numa barra");
  expect(html).toContain('data-testid="home-detail-desktop"');
  expect(html).not.toContain('data-testid="home-detail-mobile"');
  expect(html).not.toContain("Saída do veículo");
 });
 it("the chart rows are buttons and their bars are tappable",()=>{
  const bookings=[{id:"r1",start:"2026-11-04T11:00:00Z",end:"2026-11-04T23:00:00Z",status:"confirmed",label:"São Paulo Office"}];
  const html=renderToStaticMarkup(wrap(createElement(HomeGantt,{rows:[{id:"v1",name:"Ora 05",plate:"CCD0710",bookings}],locale:"pt-BR",T:fleetTexts["pt-BR"],now,headLabel:"Veículo"})));
  expect(html).toContain('role="button"');
  expect(html).toContain('data-testid="vehicle-timeline-CCD0710"');
  expect((html.match(/role="button"/g)??[]).length).toBeGreaterThanOrEqual(2); // the row and its bar
 });
});
