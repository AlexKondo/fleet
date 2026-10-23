import { getAreaText } from "@/lib/i18n/areaText";
import { operationsLoadingTexts } from "@/lib/i18n/areas/maintenanceUi";
export default async function Loading(){const T=await getAreaText(operationsLoadingTexts);return <div role="status" aria-live="polite" style={{padding:32,color:"#142644",background:"#f3f7fc",minHeight:"100vh"}}>{T.loading}</div>;}
