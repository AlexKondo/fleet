"use client";
import {useState} from "react";
import type {Dictionary} from "@/lib/i18n/dictionaries";
import {RouteMapCard} from "@/app/carpool/RouteMapCard";
/** Texts arrive from the manager's scoped offer. No passenger coordinates/places are requested. */
export function OfferRoutePreview({origin,destination,dict,locale}:{origin:string;destination:string;dict:Dictionary;locale:string}){
 const [open,setOpen]=useState(false),[unavailable,setUnavailable]=useState(false);
 return <section className="cm-card"><h2>Rota e itinerário da oferta</h2><div className="cm-route"><p>{origin} → {destination}</p><button type="button" className="cm-button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?"Ocultar mapa":"Visualizar mapa da rota"}</button><p>Estimativa da rota, sem rastreamento ao vivo. Os pontos particulares dos passageiros não são enviados ao mapa.</p>{open&&<><RouteMapCard originText={origin} destinationText={destination} dict={dict} locale={locale} onResult={result=>setUnavailable(result.status!=="ok")}/>{unavailable&&<p role="status">Mapa indisponível no momento. A consulta e as decisões de carona continuam disponíveis.</p>}</>}</div></section>;
}
