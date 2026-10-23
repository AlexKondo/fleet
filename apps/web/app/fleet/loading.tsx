import {getAreaText} from "@/lib/i18n/areaText";
import {fleetEquipmentTexts} from "@/lib/i18n/areas/fleetEquipment";
export default async function Loading(){const T=await getAreaText(fleetEquipmentTexts);return <div role="status" aria-live="polite" style={{padding:32,color:"#142644",background:"#f3f7fc",minHeight:"100vh"}}>{T.loading}</div>;}
