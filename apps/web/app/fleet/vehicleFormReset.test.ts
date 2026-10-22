import {describe,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import dict from "@/lib/i18n/dictionaries/pt-BR";
vi.mock("./actions",()=>({updateVehicle:vi.fn(),createVehicle:vi.fn()}));
vi.mock("@/lib/domain/directPhotoUpload",()=>({directPhotoUpload:vi.fn(),fieldsWithoutPhotos:(d:FormData)=>d}));
import {EditVehicleForm} from "./EditVehicleForm";
import {VehicleForm} from "./VehicleForm";
import {createVehicleWithPhoto} from "./photoSubmission";
import {vehiclePhotoTypeUnsupported} from "@/lib/domain/vehiclePhotoLimit";
const categories=[{id:"hatch",name:"Hatch Elétrico",energyType:"BEV"},{id:"suv",name:"SUV Compacto",energyType:"ICE"}];
const locations=[{id:"sp",name:"São Paulo"}];
const vehicle={id:"v1",plate:"T3M0001",name:null,color:null,photoUrl:null,category_id:"suv",odometer_km:14000,next_service_odometer_km:null,estimated_range_km:500,fuel_level_percent:70,battery_level_percent:null,home_location_id:"sp"};
/** React 19 resets a <form action={fn}> after every submission (also after a server error). SSR renders such a form
 * with a placeholder `action="javascript:throw …"`; a form submitted via onSubmit + startTransition has no action. */
const formTag=(html:string)=>html.slice(html.indexOf("<form"),html.indexOf(">",html.indexOf("<form"))+1);
describe("D-T3-01: vehicle forms keep what was typed (and the chosen category) after a server error",()=>{
 it("(control) a React form action IS detectable in the markup",()=>{
  expect(formTag(renderToStaticMarkup(createElement("form",{action:async()=>{}})))).toContain("action=");
 });
 it("edit form is not a React form action, so it is never auto-reset; the vehicle's category is the selected one",()=>{
  const html=renderToStaticMarkup(createElement(EditVehicleForm,{vehicle,categories,locations,dict,onSaved:()=>{},onCancel:()=>{}}));
  expect(formTag(html)).not.toContain("action=");
  expect(html).toMatch(/<option value="suv" selected="">SUV Compacto<\/option>/);
  expect(html).toContain('name="fuelLevelPercent"');expect(html).not.toContain('name="batteryLevelPercent"');
 });
 it("create form is not a React form action either",()=>{
  const html=renderToStaticMarkup(createElement(VehicleForm,{categories,locations,managementScope:null,dict}));
  expect(formTag(html)).toContain("<form");expect(formTag(html)).not.toContain("action=");
 });
});
describe("T2-D02: unsupported photo formats get a format message, never a fake pending photo",()=>{
 it("detects HEIC and other formats outside JPEG/PNG/WEBP",()=>{
  expect(vehiclePhotoTypeUnsupported(new File(["x"],"a.heic",{type:"image/heic"}))).toBe(true);
  expect(vehiclePhotoTypeUnsupported(new File(["x"],"a.gif",{type:"image/gif"}))).toBe(true);
  for(const type of ["image/jpeg","image/png","image/webp"])expect(vehiclePhotoTypeUnsupported(new File(["x"],"a",{type}))).toBe(false);
  expect(vehiclePhotoTypeUnsupported(null)).toBe(false);
 });
 it("create: HEIC is refused before the vehicle is saved, with the format message",async()=>{
  const save=vi.fn();const d=new FormData();d.set("plate","TEST002");d.set("photo",new File(["x"],"a.heic",{type:"image/heic"}));
  expect(await createVehicleWithPhoto({status:"idle"},d,save,"pending","format")).toEqual({status:"error",error:"format",vehicleId:undefined});
  expect(save).not.toHaveBeenCalled();
 });
 it("photo inputs only offer the accepted formats",()=>{
  const html=renderToStaticMarkup(createElement(EditVehicleForm,{vehicle,categories,locations,dict,onSaved:()=>{},onCancel:()=>{}}));
  expect(html).toContain('accept="image/jpeg,image/png,image/webp"');expect(html).not.toContain('accept="image/*"');
 });
});
