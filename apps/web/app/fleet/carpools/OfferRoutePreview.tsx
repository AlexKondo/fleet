"use client";
import {useState} from "react";
import type {Dictionary} from "@/lib/i18n/dictionaries";
import type {FleetCarpoolsKey} from "@/lib/i18n/areas/fleetCarpools";
import {RouteMapCard} from "@/app/carpool/RouteMapCard";
/** Texts arrive from the manager's scoped offer. No passenger coordinates/places are requested. */
export function OfferRoutePreview({origin,destination,dict,locale,T}:{origin:string;destination:string;dict:Dictionary;locale:string;T:Record<FleetCarpoolsKey,string>}){
 const [open,setOpen]=useState(false),[unavailable,setUnavailable]=useState(false);
 return <section className="cm-card"><h2>{T.routeTitle}</h2><div className="cm-route"><p>{origin} → {destination}</p><button type="button" className="cm-button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?T.hideMap:T.showMap}</button><p>{T.routeNote}</p>{open&&<><RouteMapCard originText={origin} destinationText={destination} dict={dict} locale={locale} onResult={result=>setUnavailable(result.status!=="ok")}/>{unavailable&&<p role="status">{T.mapUnavailable}</p>}</>}</div></section>;
}
