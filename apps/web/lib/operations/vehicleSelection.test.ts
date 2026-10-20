import {describe,it,expect} from "vitest";
import {filterVehicles,selectFilteredVehicle} from "./vehicleSelection";
const rows=Array.from({length:10},(_,i)=>({id:String(i),plate:`TEST${i}`,name:i===0?"São Paulo":null,categoryName:"Elétrico",status:i===0?"maintenance":"available"}));
describe("vehicle master/detail selection",()=>{
 it("matches accents, plate and model without broadening status filters",()=>{expect(filterVehicles(rows,"sao paulo","","").map(r=>r.id)).toEqual(["0"]);expect(filterVehicles(rows,"TEST0","available","")).toHaveLength(0);expect(filterVehicles(rows,"eletrico","available","")).toHaveLength(9);});
 it("drops hidden selection when changing page or filters",()=>{expect(selectFilteredVehicle(rows,"0",2).selected?.id).toBe("8");expect(selectFilteredVehicle(rows.slice(1),"0",1).selected?.id).toBe("1");});
 it("clamps pagination and renders no stale detail for an empty result",()=>{expect(selectFilteredVehicle(rows,null,100).page).toBe(2);expect(selectFilteredVehicle([],"0",2)).toMatchObject({page:1,pages:1,visible:[],selected:null});});
});
