import {describe,it,expect} from "vitest";
import {loadCarpoolManagement,filterManagedOffers,carpoolTab,type ManagedOffer} from "./management";
import type {TypedSupabaseClient} from "@fleet/supabase-client";
const offer=(extra:Partial<ManagedOffer>={}):ManagedOffer=>({id:"a",trip_request_id:"t",host_id:"h",hostName:null,units:[],status:"active",seats_offered:3,seats_available:2,trip:{id:"t",origin:"São Paulo",destination:"Campinas",departure_at:"2026-10-20T01:00:00Z",distance_km:90},requests:[],reservations:[],...extra});
describe("management filtering and session data",()=>{
 it("uses São Paulo departure date at the UTC day boundary",()=>{expect(filterManagedOffers([offer()],"offers","","2026-10-19")).toHaveLength(1);expect(filterManagedOffers([offer()],"offers","","2026-10-20")).toHaveLength(0);});
 it("filters routes without case sensitivity and never treats history as active offers",()=>{const rows=[offer(),offer({id:"b",status:"completed"})];expect(filterManagedOffers(rows,"offers","CAMPINAS","").map(r=>r.id)).toEqual(["a"]);expect(filterManagedOffers(rows,"history","","").map(r=>r.id)).toEqual(["b"]);});
 it("normalizes unknown tabs",()=>{expect(carpoolTab("../admin")).toBe("offers");expect(carpoolTab("accepted")).toBe("accepted");});
 it("combines independent destination and local-time filters",()=>{expect(filterManagedOffers([offer()],"offers","","",{destination:"Campinas",period:"night"})).toHaveLength(1);expect(filterManagedOffers([offer()],"offers","","",{period:"morning"})).toHaveLength(0);expect(filterManagedOffers([offer()],"offers","","",{destination:"Outro destino"})).toHaveLength(0);});
 it("allows explicit archived-state consultation without turning it into an actionable offer",()=>{const disabled=offer({status:"disabled"});expect(filterManagedOffers([disabled],"offers","","",{status:"disabled"})).toHaveLength(1);expect(filterManagedOffers([disabled],"offers","","")).toHaveLength(0);});
 it("fails the whole snapshot on a denied source rather than showing zero",async()=>{
  const seen:string[]=[];const db={from:(view:string)=>{seen.push(view);const chain={select:()=>chain,eq:()=>chain,order:()=>chain,range:async()=>({data:[],error:view==="fm_managed_ride_requests"?{message:"denied"}:null})};return chain;}} as unknown as TypedSupabaseClient;
  await expect(loadCarpoolManagement(db,"org")).rejects.toThrow("managed passengers");expect(seen.every(v=>v.startsWith("fm_managed_"))).toBe(true);
 });
});
