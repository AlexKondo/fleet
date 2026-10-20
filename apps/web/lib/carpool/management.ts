import "server-only";
import type {TypedSupabaseClient} from "@fleet/supabase-client";
import {loadUnitDimension} from "../operations/unitDimension";
import {pageAll} from "./kpi/loadKpis";

/** Session client and scoped views only. A failed source never becomes an empty list. */
export async function loadCarpoolManagement(db:TypedSupabaseClient,org:string){
 const [offers,trips,requests,reservations,people]=await Promise.all([
  pageAll("managed offers",(a,b)=>db.from("fm_managed_carpool_offers").select("id,trip_request_id,host_id,status,seats_offered,seats_available").eq("organization_id",org).order("id").range(a,b)),
  pageAll("managed trips",(a,b)=>db.from("fm_managed_trip_requests").select("id,departure_at,origin,destination,distance_km").eq("organization_id",org).order("id").range(a,b)),
  pageAll("managed passengers",(a,b)=>db.from("fm_managed_ride_requests").select("id,carpool_offer_id,rider_id,status,requested_seats,created_at").eq("organization_id",org).order("id").range(a,b)),
  pageAll("managed reservations",(a,b)=>db.from("fm_managed_reservations").select("id,trip_request_id,vehicle_id,status,vehicle:vehicles(plate)").eq("organization_id",org).order("id").range(a,b)),
  pageAll("managed people",(a,b)=>db.from("fm_managed_people").select("id,full_name").eq("organization_id",org).order("id").range(a,b)),
 ]);
 const dimension=await loadUnitDimension(db);if(!dimension)throw new Error('carpool unit dimension unavailable');
 return offers.map(offer=>({...offer,units:dimension.units.filter(u=>reservations.some(r=>r.trip_request_id===offer.trip_request_id&&r.status!=='cancelled'&&dimension.bindings.some(b=>b.vehicle_id===r.vehicle_id&&b.unit_id===u.id))).map(u=>({id:u.id,name:u.name})),hostName:people.find(p=>p.id===offer.host_id)?.full_name??null,trip:trips.find(t=>t.id===offer.trip_request_id)??null,requests:requests.filter(q=>q.carpool_offer_id===offer.id).map(q=>({...q,riderName:people.find(p=>p.id===q.rider_id)?.full_name??null})),reservations:reservations.filter(r=>r.trip_request_id===offer.trip_request_id&&r.status!=="cancelled")})).sort((a,b)=>(a.trip?.departure_at??"").localeCompare(b.trip?.departure_at??"")||a.id.localeCompare(b.id));
}
export type ManagedOffer=Awaited<ReturnType<typeof loadCarpoolManagement>>[number];
export type CarpoolTab="offers"|"pending"|"accepted"|"history";
export function carpoolTab(value?:string):CarpoolTab{return value==="pending"||value==="accepted"||value==="history"?value:"offers";}
export type OfferFilters={destination?:string;period?:string;status?:string;unit?:string};
export function filterManagedOffers(offers:ManagedOffer[],tab:CarpoolTab,query:string,day:string,filters:OfferFilters={}){
 const term=query.trim().toLocaleLowerCase("pt-BR");
 return offers.filter(o=>{
 const hour=o.trip?Number(new Intl.DateTimeFormat("en-GB",{timeZone:"America/Sao_Paulo",hour:"2-digit",hourCycle:"h23"}).format(new Date(o.trip.departure_at))):null;
 const timeMatches=!filters.period||(hour!==null&&(filters.period==="morning"?hour>=6&&hour<12:filters.period==="afternoon"?hour>=12&&hour<18:filters.period==="night"?hour>=18||hour<6:false));
 return (!filters.unit||o.units.some(u=>u.id===filters.unit))&&timeMatches&&(!filters.destination||o.trip?.destination===filters.destination)&&(!filters.status||o.status===filters.status)&&(!term||`${o.trip?.origin??""} ${o.trip?.destination??""} ${o.reservations.map(r=>r.vehicle?.plate??"").join(" ")}`.toLocaleLowerCase("pt-BR").includes(term))&&(!day||o.trip?.departure_at&&new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(o.trip.departure_at))===day)&&(tab==="offers"?(filters.status?true:o.status==="active"):tab==="pending"?o.requests.some(r=>r.status==="PENDING"):tab==="accepted"?o.requests.some(r=>r.status==="ACCEPTED"):o.status!=="active"||o.requests.some(r=>!["PENDING","ACCEPTED"].includes(r.status)));});
}
