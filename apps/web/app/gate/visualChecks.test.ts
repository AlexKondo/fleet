import {beforeEach,describe,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import dict from "@/lib/i18n/dictionaries/pt-BR";
const mock=vi.hoisted(()=>({role:"security",rpc:vi.fn(),photos:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createSupabaseServerClient:async()=>({rpc:mock.rpc,from:()=>({select:()=>({eq:()=>({single:async()=>({data:{organization_id:"org"}})})})})})}));
vi.mock("@/lib/auth/currentUser",()=>({getCurrentUser:async()=>({id:"security"})}));
vi.mock("@/lib/operations/checklistState",()=>({loadChecklistState:async()=>({inspection_role:mock.role})}));
vi.mock("@/lib/domain/uploadInspectionPhotos",()=>({uploadInspectionPhotos:mock.photos}));
const cache=vi.hoisted(()=>({revalidatePath:vi.fn()}));
vi.mock("next/cache",()=>cache);
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
import {submitVisualCheck} from "./visualActions";
import {GateVisualForm,gateDamagePhotoProblem} from "./GateVisualForm";
const form=()=>{const f=new FormData();f.set("reservationId","reservation");f.set("phase","pickup");return f;};
beforeEach(()=>{vi.clearAllMocks();mock.role="security";mock.rpc.mockResolvedValue({data:"inspection",error:null});mock.photos.mockResolvedValue([]);});
describe("approved gate visual-only process",()=>{
 it("does not ask for driver gauges or standard photos, or invent their readings",async()=>{
  const html=renderToStaticMarkup(createElement(GateVisualForm,{reservationId:"reservation",phase:"pickup",dict}));
  expect(html).not.toContain('name="odometerKm"');expect(html).not.toContain('name="photo_front"');expect(html).not.toContain('type="file"');
  expect(await submitVisualCheck(form())).toMatchObject({success:true});
  expect(mock.rpc).toHaveBeenCalledWith("record_pickup",expect.objectContaining({p_role:"security",p_odometer_km:null,p_fuel_level_percent:null,p_battery_level_percent:null,p_missing_safety_equipment:null}));
  expect(mock.photos).not.toHaveBeenCalled();
 });
 it("rejects a user who does not hold the inspection role",async()=>{
  mock.role="traveler";expect((await submitVisualCheck(form())).success).toBe(false);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("requires description and photo only when damage is observed",async()=>{
  const f=form();f.set("hasDamage","on");f.set("notes","Avaria observada");
  expect((await submitVisualCheck(f)).success).toBe(false);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("T2-D01: with damage and the photo still to be sent by the browser, the action does not revalidate (the form stays mounted to send/confirm the photo)",async()=>{
  const f=form();f.set("hasDamage","on");f.set("notes","Avaria observada");f.set("photo_upload_pending","true");
  expect(await submitVisualCheck(f)).toEqual({success:true,inspectionId:"inspection"});
  expect(mock.rpc).toHaveBeenCalledWith("record_pickup",expect.objectContaining({p_has_damage:true,p_damage_notes:"Avaria observada"}));
  expect(cache.revalidatePath).not.toHaveBeenCalled();
 });
 it("without damage the check is complete and pages are revalidated as before",async()=>{
  expect((await submitVisualCheck(form())).success).toBe(true);
  expect(cache.revalidatePath).toHaveBeenCalledWith("/gate");
 });
 it("T2-D01/T2-D02: the damage photo is validated before the check is recorded (format and 5 MB)",()=>{
  expect(gateDamagePhotoProblem(null)).toBe("missing");
  expect(gateDamagePhotoProblem(new File(["x"],"a.heic",{type:"image/heic"}))).toBe("type");
  expect(gateDamagePhotoProblem(new File([new Uint8Array(5*1024*1024+1)],"a.jpg",{type:"image/jpeg"}))).toBe("size");
  expect(gateDamagePhotoProblem(new File(["x"],"a.webp",{type:"image/webp"}))).toBeNull();
 });
});
