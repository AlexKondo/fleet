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
});
