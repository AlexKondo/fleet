import {beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({role:"fleet_manager",accept:vi.fn(),reject:vi.fn(),refresh:vi.fn()}));
vi.mock("@/lib/operations/keyCustodyLoad",()=>({loadKeySession:async()=>({profile:{role:state.role}})}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw Error(`REDIRECT:${url}`);}}));
vi.mock("next/cache",()=>({revalidatePath:state.refresh}));
vi.mock("@/app/carpool/requestActions",()=>({acceptCarpoolRequest:state.accept,rejectCarpoolRequest:state.reject}));
import {managePassenger} from "@/app/fleet/carpools/actions";
const request="e2743aca-a107-4d8c-9635-013690f2607d",offer="74078046-4929-4e8e-8ca5-ac03451940f9";
function form(decision="accept"){const f=new FormData();f.set("request_id",request);f.set("offer",offer);f.set("decision",decision);return f;}
beforeEach(()=>{state.role="fleet_manager";vi.clearAllMocks();state.accept.mockResolvedValue({status:"success"});state.reject.mockResolvedValue({status:"success"});});
describe("management decision boundary",()=>{
 it("denies employee calls before the RPC",async()=>{state.role="employee";await expect(managePassenger(form())).rejects.toThrow("REDIRECT:/dashboard");expect(state.accept).not.toHaveBeenCalled();});
 it("rejects invalid input before mutation",async()=>{const f=form();f.set("request_id","invalid");await expect(managePassenger(f)).rejects.toThrow("error=invalid_input");expect(state.accept).not.toHaveBeenCalled();});
 it("uses the existing acceptance action and refreshes the management page",async()=>{await expect(managePassenger(form())).rejects.toThrow("success=1");expect(state.accept).toHaveBeenCalledWith(request);expect(state.refresh).toHaveBeenCalledWith("/fleet/carpools");});
 it("preserves rejection reasons and reports authorization failures without success",async()=>{state.reject.mockResolvedValue({status:"error",error:"CARPOOL_NOT_AUTHORIZED"});const f=form("reject");f.set("reason","Conferir horário");await expect(managePassenger(f)).rejects.toThrow("error=CARPOOL_NOT_AUTHORIZED");expect(state.reject).toHaveBeenCalledWith(request,"Conferir horário");});
});
