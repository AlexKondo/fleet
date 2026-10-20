import {beforeEach,describe,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import dict from "@/lib/i18n/dictionaries/pt-BR";
const mock=vi.hoisted(()=>({role:"security",rpc:vi.fn(),photos:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createSupabaseServerClient:async()=>({rpc:mock.rpc,from:()=>({select:()=>({eq:()=>({single:async()=>({data:{organization_id:"org"}})})})})})}));
vi.mock("@/lib/auth/currentUser",()=>({getCurrentUser:async()=>({id:"security"})}));
vi.mock("@/lib/operations/checklistState",()=>({loadChecklistState:async()=>({inspection_role:mock.role})}));
vi.mock("@/lib/domain/uploadInspectionPhotos",()=>({uploadInspectionPhotos:mock.photos}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
import {submitVisualCheck} from "./visualActions";
import {GateVisualForm} from "./GateVisualForm";
const form=()=>{const f=new FormData();f.set("reservationId","reservation");f.set("phase","pickup");return f;};
beforeEach(()=>{vi.clearAllMocks();mock.role="security";mock.rpc.mockResolvedValue({data:"inspection",error:null});mock.photos.mockResolvedValue([]);});
describe("approved gate visual-only process",()=>{
 it("does not ask for driver gauges or standard photos, or invent their readings",async()=>{
  const html=renderToStaticMarkup(createElement(GateVisualForm,{reservationId:"reservation",phase:"pickup",dict}));
  expect(html).not.toContain('name="odometerKm"');expect(html).not.toContain('name="photo_front"');expect(html).not.toContain('type="file"');
  expect(await submitVisualCheck(form())).toEqual({success:true});
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
});
