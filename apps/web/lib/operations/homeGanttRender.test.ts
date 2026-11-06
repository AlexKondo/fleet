import {describe,expect,it,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
import {HomeGantt} from "@/app/dashboard/HomeGantt";
import {fleetTexts} from "@/lib/i18n/areas/fleet";

const now=Date.parse("2026-11-04T15:00:00Z");

describe("employee home chart",()=>{
 it("the rows and their bars can be tapped to open the reservation",()=>{
  const bookings=[{id:"r1",start:"2026-11-04T11:00:00Z",end:"2026-11-04T23:00:00Z",status:"confirmed",label:"São Paulo Office"}];
  const html=renderToStaticMarkup(createElement(HomeGantt,{rows:[{id:"v1",name:"Ora 05",plate:"CCD0710",bookings}],locale:"pt-BR",T:fleetTexts["pt-BR"],now,headLabel:"Veículo"}));
  expect(html).toContain('data-testid="vehicle-timeline-CCD0710"');
  expect((html.match(/role="button"/g)??[]).length).toBeGreaterThanOrEqual(2); // the row and its bar
 });

 const render=(bookings:{id:string;start:string;end:string;status:string;label:string;carpool?:{seats:number;taken:number};carpoolWaiting?:number}[])=>renderToStaticMarkup(createElement(HomeGantt,{rows:[{id:"v1",name:"Ora 05",plate:"CCD0710",bookings}],locale:"pt-BR",T:fleetTexts["pt-BR"],now,headLabel:"Veículo"}));
 const trip={id:"r1",start:"2026-11-07T11:00:00Z",end:"2026-11-09T23:00:00Z",status:"confirmed",label:"São Paulo"};

 it("a request waiting for the host: the little person blinks on the bar, with the number of requests",()=>{
  const html=render([{...trip,carpoolWaiting:2}]);
  expect(html).toContain('data-testid="rider-waiting"');
  expect(html).toContain('data-state="waiting"');
  expect(html).toContain("<b>2</b>");
  expect(html).toContain("Pedidos de carona aguardando confirmação: 2");
  expect(html).not.toContain('data-testid="rider-confirmed"');
 });

 it("carpool confirmed and nothing waiting: the little person is still (no number)",()=>{
  const html=render([{...trip,carpool:{seats:3,taken:1},carpoolWaiting:0}]);
  expect(html).toContain('data-testid="rider-confirmed"');
  expect(html).not.toContain('data-testid="rider-waiting"');
  expect(html).not.toContain("<b>");
 });

 it("nobody asked for a carpool: no little person on the bar",()=>{
  const html=render([trip]);
  expect(html).not.toContain('data-testid="rider-');
  expect(html).not.toContain('data-rider=');
 });

 it("the legend names both: blinking is 'aguardando confirmação', still is 'confirmada'",()=>{
  const html=render([trip]);
  expect(html).toContain('data-testid="legend-rider-waiting"');
  expect(html).toContain("Carona aguardando confirmação");
  expect(html).toContain('data-testid="legend-rider-confirmed"');
  expect(html).toContain("Carona confirmada");
 });
});
