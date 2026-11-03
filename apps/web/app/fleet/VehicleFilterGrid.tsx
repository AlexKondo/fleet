"use client";
import {useMemo,useState} from "react";
import Image from "next/image";
import type {Dictionary} from "@/lib/i18n/dictionaries";
import type {Locale} from "@/lib/i18n/locales";
import {fmt} from "./fmt";
import {fleetTexts,type FleetKey} from "@/lib/i18n/areas/fleet";
import {filterVehicles,selectFilteredVehicle} from "@/lib/operations/vehicleSelection";
import {PencilIcon,VehicleEditDialog} from "./VehicleEditDialog";
import {TimelineHeader,TimelineLane} from "./VehicleTimeline";
import {VehicleDialogTabs} from "./VehicleDialogTabs";
import type {TimelineBooking} from "./timelineLayout";
import "./vehicle-workspace.css";
export interface FilterableVehicle {
 id:string;plate:string;name:string|null;status:string;categoryName:string;node:React.ReactNode;
 unitId?:string;unitName?:string;photoUrl?:string|null;vin?:string|null;nextServiceDate?:string|null;energyType?:string;locationName?:string;odometerKm?:number;
 nextServiceKm?:number|null;fuelPercent?:number|null;batteryPercent?:number|null;rangeKm?:number|null;bookings?:TimelineBooking[];
}
/**
 * The vehicle list, one row per vehicle; on the right of each row, that vehicle's schedule (reservation bars and, when there is a carpool, carpool bars)
 * at the same height as the row. Everything else about a vehicle (data, maintenance, documents...) is in its edit popup.
 */
export function VehicleFilterGrid({vehicles,statusOptions,dict,T=fleetTexts["pt-BR"],locale="pt-BR",dimensionsAvailable=true,now=Date.now()}:{now?:number;dimensionsAvailable?:boolean;vehicles:FilterableVehicle[];statusOptions:{value:string;label:string}[];dict:Dictionary;T?:Record<FleetKey,string>;locale?:Locale}){
 const [query,setQuery]=useState(''),[status,setStatus]=useState(''),[category,setCategory]=useState(''),[selectedId,setSelectedId]=useState<string|null>(null),[page,setPage]=useState(1),[unit,setUnit]=useState(''),[editId,setEditId]=useState<string|null>(null);
 const categories=useMemo(()=>Array.from(new Set(vehicles.map(v=>v.categoryName))).sort((a,b)=>a.localeCompare(b)),[vehicles]);
 const filtered=useMemo(()=>filterVehicles(vehicles,query,status,category,unit),[vehicles,query,status,category,unit]);
 const selection=selectFilteredVehicle(filtered,selectedId,page),v=selection.selected;
 const label=(s:string)=>statusOptions.find(o=>o.value===s)?.label??s;
 const changeFilter=()=>{setPage(1);setSelectedId(null);};
 const editing=editId?vehicles.find(x=>x.id===editId)??null:null;
 const editLabel=(x:FilterableVehicle)=>`${dict.common.edit} ${x.name??x.categoryName} (${x.plate})`;
 return <div className="vw"><section className="vw-list vw-wide" aria-label={T.vehicleSelection}>
  <div className="vw-filters"><input type="search" value={query} onChange={e=>{setQuery(e.target.value);changeFilter();}} placeholder={dict.fleet.filters.searchPlaceholder} aria-label={dict.fleet.filters.searchPlaceholder}/><select value={status} onChange={e=>{setStatus(e.target.value);changeFilter();}} aria-label={dict.common.status}><option value="">{dict.fleet.filters.statusAll}</option>{statusOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><select value={category} onChange={e=>{setCategory(e.target.value);changeFilter();}} aria-label={dict.fleet.tabs.categories}><option value="">{dict.fleet.filters.categoryAll}</option>{categories.map(c=><option key={c}>{c}</option>)}</select><select aria-label={T.baseUnit} value={unit} disabled={!dimensionsAvailable} onChange={e=>{setUnit(e.target.value);changeFilter();}}><option value="">{dimensionsAvailable?T.allScopeUnits:T.unitsUnavailable}</option>{Array.from(new Map(vehicles.filter(x=>x.unitId).map(x=>[x.unitId!,x.unitName??T.unitFallback])).entries()).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>{(query||status||category||unit)&&<button type="button" onClick={()=>{setQuery('');setStatus('');setCategory('');setUnit('');changeFilter();}}>{dict.fleet.filters.clear}</button>}</div>
  <p className="vw-hint vw-hint-top">{T.editToSeeData}</p>
  <div className="vw-scroll"><div className="vw-grid">
   <div className="vw-list-heading vw-grid-row"><div className="vw-rowmain"><strong>{T.listHeadVehicle}</strong><span>{T.listHeadPropulsion}</span></div><TimelineHeader locale={locale} T={T} now={now}/></div>
   <ul>{selection.visible.map(row=><li key={row.id} className="vw-row vw-grid-row"><div className="vw-rowmain"><button type="button" className="vw-select" aria-pressed={row.id===v?.id} onClick={()=>setSelectedId(row.id)}><span className="vw-thumb">{row.photoUrl?<Image src={row.photoUrl} alt="" fill sizes="64px"/>:<span aria-hidden="true">◇</span>}</span><span><strong>{row.name??row.categoryName}</strong><small>{row.plate}</small></span><span><small>{row.energyType??'—'}</small><span className="vw-status" data-status={row.status}>{label(row.status)}</span></span></button><button type="button" className="vw-edit" aria-label={editLabel(row)} title={dict.common.edit} data-testid={`vehicle-edit-${row.plate}`} onClick={()=>setEditId(row.id)}><PencilIcon/></button></div><TimelineLane bookings={row.bookings??[]} locale={locale} T={T} now={now} plate={row.plate}/></li>)}</ul>
  </div></div>
  {filtered.length===0&&<p className="vw-empty">{dict.fleet.filters.noMatches}</p>}
  <footer className="vw-pagination"><span>{fmt(T.paginationSummary,{count:filtered.length,page:selection.page,pages:selection.pages})}</span><button type="button" disabled={selection.page<=1} onClick={()=>{setPage(selection.page-1);setSelectedId(null);}}>{T.previous}</button><button type="button" disabled={selection.page>=selection.pages} onClick={()=>{setPage(selection.page+1);setSelectedId(null);}}>{T.next}</button></footer>
 </section>
 {editing?<VehicleEditDialog key={editing.id} title={editLabel(editing)} closeLabel={dict.common.close} onClose={()=>setEditId(null)}><VehicleDialogTabs v={editing} T={T} locale={locale} dimensionsAvailable={dimensionsAvailable} form={editing.node}/></VehicleEditDialog>:null}</div>;
}
