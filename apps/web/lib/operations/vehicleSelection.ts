export type VehicleFilterItem={id:string;plate:string;name:string|null;status:string;categoryName:string;unitId?:string};
export function filterVehicles<T extends VehicleFilterItem>(vehicles:T[],query:string,status:string,category:string,unit=""){
 const fold=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");const term=fold(query.trim());
 return vehicles.filter(v=>(!unit||v.unitId===unit)&&(!status||v.status===status)&&(!category||v.categoryName===category)&&(!term||fold(`${v.plate} ${v.name??""} ${v.categoryName}`).includes(term)));
}
/** A filtered-out or removed selection must never leave another vehicle's detail visible. */
export function selectFilteredVehicle<T extends {id:string}>(rows:T[],selectedId:string|null,page:number,size=8){
 const currentPage=Math.min(Math.max(1,Number.isSafeInteger(page)?page:1),Math.max(1,Math.ceil(rows.length/size)));
 const visible=rows.slice((currentPage-1)*size,currentPage*size);
 return {page:currentPage,visible,selected:visible.find(v=>v.id===selectedId)??visible[0]??null,pages:Math.max(1,Math.ceil(rows.length/size))};
}
